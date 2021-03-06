/**
 * Created by ashu on 21/11/14.
 */

var httpProxy = require('http-proxy');
var url = require('url');
var proxy = httpProxy.createProxyServer();
var MongoClient = require("mongodb").MongoClient;
var Config = require("./Config.js");
var Mappings = require("./Mappings.js");
var DBS = {};
var COLLECTIONS = {};
var domainMap = {};
var mapping = new Mappings();

proxy.on('error', function (err, req, res) {
    maintainErrorLogs(err, req, res);
});

/*Set the user ip into headers so that server running behind the proxy can get the ip of user @sourbh */
proxy.on('proxyReq', function (proxyReq, req, res, options) {
    proxyReq.setHeader('remoteip', req.connection.remoteAddress);
});

function connectMongo(dbName, callback) {
    if (DBS[dbName]) {
        callback(null, DBS[dbName]);
    } else {
        MongoClient.connect(Config.MONGO_URL + "/" + dbName, function (err, db) {
            if (err) {
                callback(err);
                return;
            }
            /*topology destroyed issue - clear the cache connection to resolve @sourbh - 1-6-17*/
            db.on("timeout", function (error, db) {
                DBS = {};
                COLLECTIONS = {};
            })
            db.on("close", function () {
                DBS = {};
                COLLECTIONS = {};
            });
            db.authenticate(Config.MONGOADMIN_USER, Config.MONGOADMIN_PASS, {authdb: Config.MONGOADMIN_DB}, function (err, res) {
                if (err) {
                    callback(err);
                } else if (!res) {
                    callback(new Error("Auth fails"));
                } else {
                    DBS[dbName] = db;
                    callback(null, DBS[dbName]);
                }
            })
        })
    }
}

function getCollection(collectionName, dbName, callback) {
    connectMongo(dbName, function (err, db) {
        if (err) {
            callback(err);
        } else {
            COLLECTIONS[dbName] = COLLECTIONS[dbName] || {};
            COLLECTIONS[dbName][collectionName] = COLLECTIONS[dbName][collectionName] || db.collection(collectionName);
            callback(null, COLLECTIONS[dbName][collectionName]);
        }
    })
}

function loadUrls(callback) {
    getCollection(Config.PROXYTABLE, Config.ADMIN_DB, function (err, proxyCollection) {
        if (err) {
            callback(err);
        } else {
            proxyCollection.find({}, {}).toArray(function (err, result) {
                if (err) {
                    callback(err);
                    return;
                }
                var MAPPINGS = {};
                for (var i = 0; i < result.length; i++) {
                    var map = result[i];
                    if (map.source && map.target) {
                        MAPPINGS[map.source] = map;
                    }
                }
                mapping.setMappings(MAPPINGS);
                callback();
            })
        }
    })
}

function getFieldValue(hostname, field, uri) {
    var MAPPINGS = mapping.getMappings();
    if (MAPPINGS) {
        var value = MAPPINGS[hostname] ? MAPPINGS[hostname][field] : undefined;
        if (!value) {
            value = MAPPINGS["default"] ? MAPPINGS["default"][field] : undefined;
        }
        var customUriDef = MAPPINGS[hostname] ? MAPPINGS[hostname]["customUri"] : undefined;
        if (uri && (field === "target") && customUriDef && (customUriDef.length > 0)) {
            for (var i = 0; i < customUriDef.length; i++) {
                var map = customUriDef[i];
                if (map.sourceUri && map.uriTarget && (uri.indexOf(map.sourceUri) === 0)) {
                    value = map.uriTarget;
                    break;
                }
            }
        }
        return value;
    } else {
        loadUrls(function (err) {
            if (err) {
                maintainErrorLogs(err);
            } else {
                getFieldValue(field, hostname);
            }
        })
    }
}

function printError(mainError, dbError, reqInfo, req, resp) {
    if (reqInfo && req) {
        console.error(reqInfo);
    }
    if (mainError) {
        console.error("Error in ProxyServer : " + mainError.stack || mainError.message || mainError);
    }
    if (dbError) {
        console.error("Error in ProxyServer (DB): " + dbError.stack || dbError.message || dbError);
    }
    if (resp && resp.writeHead) {
        var hostname = req.headers.host;
        var errorHtml = getFieldValue(hostname, "errorHTML");
        if (!errorHtml) {
            errorHtml = "<body>Something went wrong during redirection. We are reporting an error message.</body>";
        }
        resp.writeHead(500, {"Content-Type": "text/html"});
        resp.write(errorHtml);
        resp.end();
    }
}

exports.handleuncaughtException = function (err) {
    maintainErrorLogs(err);
};

function maintainErrorLogs(error, req, resp) {
    var reqInfo = {};
    if (req) {
        reqInfo.host = req.headers.host;
        reqInfo.url = req.url;
        if (req.method == 'POST') {
            var body = '';
            req.on('data', function (data) {
                body += data;
            });
            req.on('end', function () {
                var qs = require('querystring');
                var data = (qs.parse(body));
                reqInfo.postparams = data;
            });
        }
        else if (req.method == 'GET') {
            var url_parts = url.parse(req.url, true);
            reqInfo.getparams = url_parts.query;
        }
    }
    getCollection(Config.LOGTABLE, Config.LOG_DB, function (err, logCollection) {
        if (err) {
            printError(error, err, reqInfo, req, resp);
        } else {
            logCollection.insert({
                "errorTime": new Date(),
                reqInfo: reqInfo,
                error: error.stack || error.message || error
            }, function (err) {
                printError(error, err, reqInfo, req, resp);
            })
        }
    })
}

function runProxyServer(req, res, head, isWS) {
    var hostname = req.headers.host;
    var target = getFieldValue(hostname, "target", req.url);
    if (!target) {
        maintainErrorLogs(new Error("Target Url not found for host " + hostname), req, res);
    } else {
        if (isWS) {
            proxy.ws(req, res, head, {
                target: target
            });
        } else {
            proxy.web(req, res, {
                target: target
            });
        }

    }
}

function getProxyServer(req, res, head, isWS) {
    var MAPPINGS = mapping.getMappings();
    if (MAPPINGS) {
        runProxyServer(req, res, head, isWS);
    } else {
        loadUrls(function (err) {
            if (err) {
                maintainErrorLogs(err, req, res);
            } else {
                runProxyServer(req, res, head, isWS);
            }
        });
    }
}

exports.runSocket = function (proxyServer) {
    proxyServer.on('upgrade', function (req, socket, head) {
        /*Use getProxyServer for runProxyServer on httpproxyclearcachedb need to populate Mapping from DB again - Sachin 06-06-17*/
        getProxyServer(req, socket, head, true);
    });
}

exports.runProxy = function (req, res) {
    if (req.url === "/rest/runningStatus") {
        res.writeHead(200);
        res.write("Server Running");
        res.end();
        return;
    }
    if (req.url === "/httpproxyclearcachedb") {
        // if mapping values are changed
        res.end("ProxyServer Cache Cleared. \nMAPPINGS cleared from Cache : " + JSON.stringify(mapping.getMappings()));
        mapping.clearMappings();
        return;
    }
    updateDomainMap(req.headers.host);
    getProxyServer(req, res);
};

function updateDomainMap(hostname) {
    if (typeof hostname !== "string") {
        hostname = hostname.toString();
    }
    console.log("updateDomainMap is called" + hostname);
    domainMap[hostname] = domainMap[hostname] || 0;
    domainMap[hostname] += 1;
}

function updateDomainCalls() {
    setTimeout(function () {
        var mapCopy = JSON.parse(JSON.stringify(domainMap));
        domainMap = {};
        getCollection(Config.DOMAINTABLE, Config.LOG_DB, function (err, domainCollection) {
            var domainNames = mapCopy ? Object.keys(mapCopy) : [];

            function upsertValue(i) {
                if (i < domainNames.length) {
                    domainCollection.updateOne({domainName: domainNames[i]}, {$inc: {callCount: mapCopy[domainNames[i]]}}, {upsert: true}, function (err) {
                        if (err) {
                            console.error('error: ' + err);
                        }
                        else {
                            upsertValue(i + 1);
                        }
                    })
                } else {
                    updateDomainCalls();
                }
            }

            upsertValue(0);
        });
    }, 15000)
}

updateDomainCalls();


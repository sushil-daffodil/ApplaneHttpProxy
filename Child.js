/**
 * Created by ashu on 21/11/14.
 */

var httpProxy = require('http-proxy');
var url = require('url');
var proxy = httpProxy.createProxyServer({});
var MongoClient = require("mongodb").MongoClient;
var Config = require("./Config.js");
var MAPPINGS = undefined;
var DBS = {};
var COLLECTIONS = {};

proxy.on('error', function (err, req, res) {
    maintainErrorLogs(err, req, res);
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
                MAPPINGS = {};
                for (var i = 0; i < result.length; i++) {
                    var map = result[i];
                    if (map.source && map.target) {
                        MAPPINGS[map.source] = map.target;
                    }
                }
                callback();
            })
        }
    })
}

function printError(mainError, dbError, reqInfo,req, resp) {
    if(reqInfo && req){
        console.error(reqInfo);
    }
    if (mainError) {
        console.error("Error in ProxyServer : " + mainError.stack || mainError.message || mainError);
    }
    if (dbError) {
        console.error("Error in ProxyServer (DB): " + dbError.stack || dbError.message || dbError);
    }
    if(resp){
        resp.writeHead(500, {
            'Content-Type': 'text/plain'
        });
        resp.end('Something went wrong during redirection. We are reporting an error message.');
    }
}

exports.handleuncaughtException = function (err) {
    maintainErrorLogs(err);
};

function maintainErrorLogs(error, req, resp) {
    var reqInfo = "";
    if(req){
        reqInfo = "req >> "+req.url+">>>host>>>"+req.headers.host;
    }
    getCollection(Config.LOGTABLE, Config.LOG_DB, function (err, logCollection) {
        if (err) {
            printError(error, err, reqInfo,req, resp);
        } else {
            logCollection.insert({"errorTime": new Date(),reqInfo:reqInfo, error: error.stack || error.message || error}, function (err) {
                printError(error, err, reqInfo,req, resp);
            })
        }
    })
}

function runProxyServer(req, res) {
    var hostname = req.headers.host;
    var target = MAPPINGS[hostname] || MAPPINGS["default"];
    if (!target) {
        maintainErrorLogs(new Error("Target Url not found for host " + hostname), req, res)
    } else {
        proxy.web(req, res, { target: target });
    }
}

function getProxyServer(req, res) {
    if (MAPPINGS) {
        runProxyServer(req, res);
    } else {
        loadUrls(function (err) {
            if (err) {
                maintainErrorLogs(err, req, res);
            } else {
                runProxyServer(req, res);
            }
        });
    }
}

exports.runProxy = function (req, res) {
//    var pathname = url.parse(req.url).pathname;
    if (req.url === "/httpproxyclearcache") {
        res.end("ProxyServer Cache Cleared. Previous Cache Value : ");
        MAPPINGS = undefined;
        return;
    }
    getProxyServer(req, res);
};

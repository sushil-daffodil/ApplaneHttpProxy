/**
 * Created by ashu on 21/11/14.
 */

var httpProxy = require('http-proxy');
var url = require('url');
var proxy = httpProxy.createProxyServer({});
var MongoClient = require("mongodb").MongoClient;
var Config = require("./Config.js");
var MAPPINGS = undefined;
var MONGO_DB = undefined;
var URL_MAPPING_COLLECTION = undefined;
var URL_MAPPING_LOGS_COLLECTION = undefined;

function connectMongo(callback) {
    if (MONGO_DB) {
        callback(null, MongoClient)
    } else {
        MongoClient.connect(Config.MONGO_URL + "/" + Config.ADMIN_DB, function (err, db) {
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
                    MONGO_DB = db;
                    callback(null, MONGO_DB);
                }
            })
        })
    }
}

function loadUrls(callback) {
    connectMongo(function (err, db) {
        if (err) {
            callback(err);
        } else {
            if (!URL_MAPPING_COLLECTION) {
                URL_MAPPING_COLLECTION = db.collection(Config.PROXYTABLE);
            }
            URL_MAPPING_COLLECTION.find({}, {}).toArray(function (err, result) {
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

function maintainErrorLogs(error, callback) {
    console.log(error);
    callback();
//    connectMongo(function (err, db) {
//        if (err) {
//            callback(err);
//        } else {
//            if (!URL_MAPPING_LOGS_COLLECTION) {
//                URL_MAPPING_LOGS_COLLECTION = db.collection(Config.LOGTABLE);
//            }
//            URL_MAPPING_LOGS_COLLECTION.insert({"errorTime": new Date(), error: error.stack || error.message || error}, function (err, result) {
//                if (err) {
//                    callback(err);
//                    return;
//                }
//                callback();
//            })
//        }
//    })
}

function runProxyServer(req, res) {
    var hostname = req.headers.host;
    var target = MAPPINGS[hostname] || MAPPINGS["default"];
    if (!target) {
        maintainErrorLogs("Target Url not found.", function (error, result) {
            if (error) {
                console.error("Error in ProxyServer : " + error);
            }
            res.writeHead(500, {
                'Content-Type': 'text/plain'
            });
            res.end('Something went wrong during redirection. We are reporting an error message.');
        })
    }else{
        proxy.web(req, res, { target: target });
    }
}

function getProxyServer(req, res) {
    if (MAPPINGS) {
        runProxyServer(req, res);
    } else {
        loadUrls(function (err, result) {
            if (err) {
                maintainErrorLogs(err, function (error, result) {
                    if (error) {
                        console.error("Error in ProxyServer : " + error);
                    }
                    res.writeHead(500, {
                        'Content-Type': 'text/plain'
                    });
                    res.end('Something went wrong during redirection. We are reporting an error message.');
                });
            } else {
                runProxyServer(req, res);
            }
        });
    }
}

exports.runProxy = function (req, res) {
    var pathname = url.parse(req.url).pathname;
    if (pathname === "/httpproxyclearcache") {
        res.end("ProxyServer Cache Cleared. Previous Cache Value : ");
        MAPPINGS = undefined;
        return;
    }
    proxy.on('error', function (err, req, res) {
        maintainErrorLogs(err, function (error, result) {
            if (error) {
                console.error("Error in ProxyServer : " + error);
            }
            res.writeHead(500, {
                'Content-Type': 'text/plain'
            });
            res.end('Something went wrong during redirection. We are reporting an error message.');
        });
    });
    getProxyServer(req, res);
};

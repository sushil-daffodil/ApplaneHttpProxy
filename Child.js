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
            console.error("Error in db get.." + err)
        } else {
            if (!URL_MAPPING_COLLECTION) {
                URL_MAPPING_COLLECTION = db.collection("pl.httpproxyurlmappings");
            }
            URL_MAPPING_COLLECTION.find({}, {}).toArray(function (err, result) {
                if (err) {
                    console.error("Error in db get.." + err);
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

function runProxyServer(req, res, hostname) {
    if (!MAPPINGS[hostname]) {
        hostname = "default";
    }
    var target = MAPPINGS[hostname];
    target = "http://" + target;
    proxy.web(req, res, { target: target });
}

function getProxyServer(req, res, hostname) {
    console.log("MAPPING in getProxyServer : " + JSON.stringify(MAPPINGS));
    if (MAPPINGS) {
        console.log("available... :) ");
        runProxyServer(req, res, hostname);
    } else {
        console.log("going to load ... :( ");
        loadUrls(function (err, result) {
            if (err) {
                console.log("Error in getProxyServer..." + err);
                return;
            }
            runProxyServer(req, res, hostname);
        });
    }
}

exports.runProxy = function (req, res) { 
    console.log("Child called...");
    var hostname = req.headers.host;
    var pathname = url.parse(req.url).pathname;
    console.log("hostname : " + hostname);
    console.log("pathname : " + pathname);
    if (pathname == "/httpproxyclearcache") {
        MAPPINGS = undefined;
        res.end("Http Proxy Cache Cleared.");
        return;
    }
    proxy.on('error', function (err, req, res) {
        res.writeHead(500, {
            'Content-Type': 'text/plain'
        });
        res.end('Something went wrong during redirection. We are reporting an error message.');
    });
    getProxyServer(req, res, hostname);
};

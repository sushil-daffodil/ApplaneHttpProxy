/**
 * Created by ashu on 21/11/14.
 */

var http = require('http');
var Config = require("./Config.js");
var Child = require("./Child.js");

process.on('uncaughtException', function (err) {
    require("./Child.js").handleuncaughtException(err);
});

var proxyServer = http.createServer(function (req, res) {
    if (req.url === "/httpproxyclearcachechild") {
        // if code in child.js is changed
        var cache = require.cache;
        for (var key in cache) {
            if (key.indexOf("Child.js") !== -1) {
                delete cache[key];
            }
        }
        res.end("Cache cleared : " + key);
        Child = require("./Child.js");
    } else {
        Child.runProxy(req, res);
    }
}).listen(Config.PORT, function () {
    console.log("proxy server running on port (default : 80) :" + Config.PORT);
});

Child.runSocket(proxyServer);

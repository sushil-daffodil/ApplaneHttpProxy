/**
 * Created by ashu on 21/11/14.
 */

var http = require('http');
var Config = require("./Config.js");

http.createServer(
    function (req, res) {
        require("./Child.js").runProxy(req, res);
    }).listen(Config.PORT, function () {
        console.log("proxy server running on default port 80");
    });


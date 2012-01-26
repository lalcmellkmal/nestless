var fs = require('fs');

exports.message = 'Hard work and guts!';

exports.read = function (cb) {
	fs.readFile('message.txt', 'UTF-8', cb);
};

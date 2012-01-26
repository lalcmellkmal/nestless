var assert = require('assert');

function passThrough(obj, cb) {
	cb(null, obj);
}

function go(arg, cb) {
	msg <- require('fs').readFile('message.txt', 'UTF-8');
	msgPrime <- passThrough({a: {msg: msg}});
	return {wrap: {arg: arg, msg: msgPrime.a.msg}};
}

go('hello', function (err, obj) {
	assert.ifError(err);
	assert.ok(obj && obj.wrap, 'No object');
	obj = obj.wrap;
	assert.equal(obj.arg, 'hello');
	assert.equal(obj.msg, 'Hard work and guts!');
});

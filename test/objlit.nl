var assert = require('assert'),
    common = require('./common');

function passThrough(obj, cb) {
	cb(null, obj);
}

function go(arg, cb) {
	msg <- common.read();
	msgPrime <- passThrough({a: {msg: msg}});
	return {wrap: {arg: arg, msg: msgPrime.a.msg}};
}

go('hello', function (err, obj) {
	assert.ifError(err);
	assert.ok(obj && obj.wrap, 'No object');
	obj = obj.wrap;
	assert.equal(obj.arg, 'hello');
	assert.equal(obj.msg, common.message);
});

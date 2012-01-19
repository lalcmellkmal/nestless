var assert = require('assert');

function go(arg, cb) {
	msg <- require('fs').readFile('message.txt', 'UTF-8');
	return {arg: arg, msg: msg};
}

go('hello', function (err, obj) {
	assert.ifError(err);
	assert.ok(obj, 'No object');
	assert.equal(obj.arg, 'hello');
	assert.equal(obj.msg, 'Hard work and guts!');
});

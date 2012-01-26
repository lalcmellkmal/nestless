var assert = require('assert'),
    common = require('./common');

function plainBlock(cb) {
	var foo;
	{
		msg <- common.read();
		return msg;
	}
	return 'nope';
}

plainBlock(function (err, msg) {
	assert.ifError(err);
	assert.equal(msg, common.message);
});

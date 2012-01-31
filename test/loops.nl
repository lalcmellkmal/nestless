var assert = require('assert'),
    common = require('./common');

function go(cb) {
	msg <- common.read();
	// Make sure loops are ignored
	for (var i = 0; i < msg.length; i++) {
		break;
		throw 'nope';
	}
	for (var k in {foo: 'bar'}) {
		break;
	}
	while (true) {
		break;
		throw 'nope';
	}
	do {
		if (1 + 1 == 3)
			continue;
	} while (false);
	return msg;
}

go(function (err, result) {
	assert.ifError(err);
	assert.equal(result, common.message);
});

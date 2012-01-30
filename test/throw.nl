var assert = require('assert'),
    common = require('./common');

function go(cb) {
	msg <- common.read();
	assert.throws(function () {
		throw new Error('Nope');
	});

	var caught = false;
	try {
		JSON.parse('{{{');
	}
	catch (e) {
		caught = true;
	}
	finally {
		assert.ok(caught);
	}

	if (msg == common.message) {
		_ <- common.read();
		throw 'Should become fail callback';
	}
	return 'Should not succeed';
}

go(function (err, result) {
	assert.equal(err, 'Should become fail callback');
	assert.notEqual(result, 'Should not succeed');
});

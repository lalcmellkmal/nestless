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

	throw 'Should become fail callback';
}

go(function (err) {
	assert.equal(err, 'Should become fail callback');
});

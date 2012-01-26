var assert = require('assert'),
    common = require('./common');

function betweenTheLines(callback) {
	guts <- common.read();
	callback(null, guts, false, false, 'Buster X', false);
}

function go(cb) {
	guts, _, _ <- betweenTheLines();
	assert.ok(typeof _ == 'undefined', 'Underscores not removed');
	_, _, _, attack, _ <- betweenTheLines();
	assert.ok(typeof _ == 'undefined', 'Underscores not deduped');
	return {guts: guts, attack: attack};
}

go(function (err, obj) {
	assert.ifError(err);
	assert.equal(obj.guts, common.message);
	assert.equal(obj.attack, 'Buster X');
});

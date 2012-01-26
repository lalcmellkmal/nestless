var assert = require('assert');

function betweenTheLines(callback) {
	guts <- require('fs').readFile('message.txt', 'UTF-8');
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
	assert.equal(obj.guts, 'Hard work and guts!');
	assert.equal(obj.attack, 'Buster X');
});

"use strict";

function go(cb) {
	guts <- require('fs').readFile('message.txt', 'UTF-8');
	return guts;
}

go(function (err, guts) {
	var assert = require('assert');
	assert.ifError(err);
	assert.equal(guts, 'Hard work and guts!');
});

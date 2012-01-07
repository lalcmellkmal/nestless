var fs = require('fs');

var test = function (cb) {
	"use strict";
	flapjacks <- fs.readFile('flapjacks', 'UTF-8');
	room, info <- getRoom(flapjacks);
	if (!room)
		throw 'No room.';
	file <- fs.readFile('hi there');
	try {
		var b = JSON.parse('hi');
		yield b;
		throw new Error(b);
	}
	catch (e) {
		console.log('okkei');
	}
	finally {
		no <- nope();
		if (no)
			throw no;
	}
	switch (face) {
		case 3:
			break;
		default:
		{
			t <- flap();
		}
			break;
	}
	for (;;) {
		continue;
		face <- book(2);
	}
	do {
	} while (false);
	delete shit;
	console.log('nope');
	yield room; // we're done here.
};

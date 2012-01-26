var child_process = require('child_process'),
    fs = require('fs'),
    join = require('path').join;

var TIMEOUT = 1000;

var total = 0, run = 0, fails = 0;

var spawnOpts = {cwd: __dirname, env: process.env, setsid: false};

function compileNestless(src, dest, cb) {
	var args = ['../nestless.js', src, '-o', dest];
	var compile = child_process.spawn('node', args, spawnOpts);
	compile.stdout.pipe(process.stdout, {end: false});
	compile.stderr.pipe(process.stderr, {end: false});
	compile.once('exit', function (code) {
		cb(code == 0 ? null : src + ' did not compile.');
	});
}

function nextTest(tests) {
	if (!tests.length)
		return done();
	var testNl = tests.shift();
	var m = testNl.match(/^(.*)\.nl$/);
	if (!m)
		return nextTest(tests);
	var testJs = 'test-' + m[1] + '.js';
	total++;
	fs.unlink(join(__dirname, testJs), function () {
		compileNestless(testNl, testJs, function (err) {
			if (err) {
				console.error(err);
				fails++;
				nextTest(tests);
			}
			else
				runTest();
		});
	});
	function runTest() {
		var path = join(__dirname, testJs);
		var proc = child_process.spawn('node', [path], spawnOpts);
		run++;
		proc.stdout.pipe(process.stdout, {end: false});
		proc.stderr.pipe(process.stderr, {end: false});
		var timeout = setTimeout(function () {
			proc.removeAllListeners('exit');
			proc.kill();
			console.error(testNl + ' timed out.');
			fails++;
			nextTest(tests);
		}, TIMEOUT);
		proc.once('exit', function (code) {
			clearTimeout(timeout);
			if (code != 0) {
				console.error(testNl + ' failed.');
				fails++;
			}
			nextTest(tests);
		});
	}
}

function done() {
	var plural = function (n) { return n == 1 ? '' : 's'; };
	var tests = run + ' test' + plural(run);
	if (total > run)
		tests += ' of ' + total;
	var failures = fails + ' failure' + plural(fails);
	console.log('Ran ' + tests + ' with ' + failures + '.');
	process.exit(fails);
}

fs.readdir(__dirname, function (err, tests) {
	if (err)
		throw err;
	nextTest(tests);
});

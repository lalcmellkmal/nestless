var fs = require('fs'),
    parser = require('./parser'),
    util = require('util');

// Global constants
require('./jsdefs');
var tokenIds = Narcissus.definitions.tokenIds;
eval(Narcissus.definitions.consts);
const CALLBACK_RE = /c(?:all)?b(?:ack)?/i;

// Global state
var stack = [];
var replacements = {};

function nodeType(node) {
	var type = node.type;
	for (var name in tokenIds)
		if (tokenIds[name] === type)
			return name;
	return '<unknown node type>';
}

function replace(start, end, str) {
	if (!start)
		throw new Nope("Invalid start", start, end);
	if (start in replacements)
		throw new Nope("Replacement exists", start, end);
	replacements[start] = {end: end, str: str};
}

function insert(pos, str) {
	if (!pos)
		throw new Nope("Invalid insertion pos " + pos);
	var old = replacements[pos];
	if (old)
		old.str = str + old.str;
	else
		replacements[pos] = {end: pos, str: str};
}

function close(str) {
	stack[0].closes.unshift(str);
}

function block(node, extra) {
	if (node.type != BLOCK)
		throw new Nope("That's no block!", node);
	var prev = stack[0] || {level: 0};
	var scope = {level: prev.level+1, closes: [], callback: prev.callback};
	['canYield', 'canThrow', 'canBreakContinue'].forEach(function (inherit) {
		scope[inherit] = prev[inherit];
	});
	if (extra)
		for (var k in extra)
			scope[k] = extra[k];

	stack.unshift(scope);
	node.children.forEach(stmt);
	if (stack.shift() !== scope)
		throw new Nope("Imbalanced block?!", node);

	if (scope.closes.length) {
		if (!node.realEnd)
			throw new Nope("Can't bind in a switch; please wrap with {}s", node);
		insert(node.realEnd - 1, scope.closes.join(''));
	}
}

function func(node) {
	var prev = stack[0] || {level: 0};
	var scope = {level: prev.level+1, closes: []};
	stack.unshift(scope);

	var params = node.params;
	if (params) {
		var lastParam = params[params.length-1];
		if (lastParam.match(CALLBACK_RE))
			scope.callback = lastParam;
	}
	var script = node.body;
	if (script.type == GENERATOR)
		script = script.body;
	if (script.type != SCRIPT)
		throw new Nope("Unexpected in function form", node);
	script.children.forEach(stmt);
	if (stack.shift() !== scope)
		throw new Nope("Imbalanced block?!", node);
	if (scope.closes.length)
		insert(node.end-1, scope.closes.join(''));
}

function expr(node) {
	var scope = stack[0];
	switch (node.type) {
	case CALL:
	case DOT:
	case LIST:
		node.children.forEach(expr);
		break;

	case DELETE:
	case IDENTIFIER:
	case STRING:
		break;

	case FUNCTION:
		func(node);
		break;

	case YIELD:
		if (!stack.length)
			throw new Nope("Can't yield in global scope", node);
		var scope = stack[0];
		if (scope.callback && scope.canYield) {
			replace(node.start, node.start+6, 'return '+scope.callback+'(null, ');
			insert(node.value.end, ')');
		}
		else
			throw new Nope("Can't yield in non-bound scope", node);
		break;

	default:
		console.log(nodeType(node));
		node.children.forEach(expr);
		break;
	}
}

function stmt(node) {
	var scope = stack[0];
	switch (node.type) {
	case BLOCK:
		block(node);
		break;
	case IF:
		stmt(node.thenPart);
		if (node.elsePart)
			stmt(node.elsePart);
		break;
	case DO:
	case FOR:
	case WHILE:
		// ignore conditions etc.
		if (node.body.type == BLOCK)
			block(node.body, {canBreakContinue: true});
		else
			stmt(node.body);
		break;
	case SWITCH:
		node.cases.forEach(function (casa) {
			block(casa.statements, {canBreakContinue: true, cannotBind: true});
		});
		break;
	case TRY:
		block(node.tryBlock, {canThrow: false});
		node.catchClauses.forEach(function (clause) {
			block(clause.block);
		});
		if (node.finallyBlock)
			block(node.finallyBlock);
		break;

	case FUNCTION:
		func(node);
		break;

	case BREAK:
	case CONTINUE:
		if (!scope.canBreakContinue)
			throw new Nope("Can't " + (node.type == BREAK ? "break" : "continue") + " after binding", node);
		break;

	case RETURN:
		if (node.children.length)
			expr(node.children[0]);
		/* TODO: Check when can't eject */
		break;
	case SEMICOLON:
		var arrow = node.expression;
		var params = [];
		while (arrow.type == COMMA) {
			var ident = arrow.children[0];
			if (!ident || ident.type != IDENTIFIER)
				throw new Nope('Expected identifier', ident);
			params.push(ident.value);
			arrow = arrow.children[1];
		}
		if (arrow.type != LT) {
			//if (params.length)
			//	throw new Nope("Orphaned comma expression", node);
			expr(node.expression);
			break;
		}
		if (!stack.length)
			throw new Nope("Can't bind in global scope; please wrap in {}s", node);
		if (scope.cannotBind)
			throw new Nope("Can't bind in a switch; please wrap in {}s", node);
		var cb = scope.callback;
		if (!cb)
			throw new Nope("Can't bind inside a function without a callback parameter", node);
		scope.canYield = true;
		scope.canThrow = true;
		scope.canBreakContinue = false;
		var minus = arrow.children[1];
		if (minus.type != UNARY_MINUS)
			throw new Nope('Incomplete arrow', arrow);
		var ident = arrow.children[0];
		if (ident.type != IDENTIFIER)
			throw new Nope('Identifier(s) expected before arrow', arrow);
		params.push(ident.value);
		var rhs = arrow.children[1].children[0];
		if (rhs.type != CALL)
			throw new Nope('Call expected after arrow', arrow);
		var argList = rhs.children[1];
		if (rhs.children.length != 2 || argList.type != LIST)
			throw new Nope('Unexpected call format', rhs);
		var args = argList.children;
		replace(node.start, rhs.start, '');
		var err = 'err';
		params.unshift(err);
		var newCall = 'function (' + params.join(', ') + ') { if ('+err+') return '+cb+'('+err;
		if (args.length > 0)
			newCall = ', ' + newCall;
		replace(argList.end, node.end, newCall);
		close('}); ');
		break;
	case THROW:
		if (!stack.length)
			break;
		var scope = stack[0];
		if (scope.callback && stack.canThrow) {
			replace(node.start, node.start+6, 'return '+scope.callback+'(');
			insert(node.exception.end, ')');
		}
		break;
	case VAR:
		node.children.forEach(function (decl) {
			if (decl.initializer)
				expr(decl.initializer);
		});
		break;
	default:
		console.error(node);
		throw new Nope('Unexpected ' + nodeType(node), node);
	}
}

function emit(src) {
	var points = Object.keys(replacements).map(function (x) {
		return parseInt(x, 10);
	});
	points.sort(function (b, a) { return b - a; });

	var prev = 0;
	points.forEach(function (p) {
		var color = require('ansi-color');
		var repl = replacements[p];
		var before = "replacing ..." + src.substring(p-10, p).replace(/\s/g, ' ') + '`';
		var quote = src.substring(p, repl.end);
		var after = "`" + src.substring(repl.end, repl.end+10).replace(/\s/g, ' ') + "...";
		var width = 60;
		var space = Math.max(0, width - before.length - quote.length - after.length - 2);
		space = Array(space+1).join(' ');
		var extra = '';
		if (p < prev)
			extra = color.set(' SKIPPED', 'red');
		console.error(before + color.set(quote, 'red') + after + space + "-> '" + color.set(repl.str, 'green') + "'" + extra);
		prev = repl.end;
	});

	var out = process.stdout;
	var pos = 0;
	while (pos < src.length) {
		var next = points.length ? points.shift() : src.length;
		while (next < pos) {
			var repl = replacements[next];
			console.warn("\nSKIPPING REPLACEMENT >>>" + repl.str + "<<<\n");
			next = points.length ? points.shift() : src.length;
		}
		out.write(src.substring(pos, next));
		pos = next;
		if (next >= src.length)
			break;
		var repl = replacements[pos];
		if (!repl)
			throw new Error("Replacement disappeared at " + pos + "?!");
		out.write(repl.str);
		if (repl.end < pos)
			throw new Error('Replacement would back up');
		pos = repl.end;
	}
}

function Nope(message, node, end) {
	Error.call(this, message);
	Error.captureStackTrace(this, this.constructor);
	this.message = message;
	this.node = (node instanceof Number) ? {start: node, end: end} : node;
}
util.inherits(Nope, Error);

function flatten(src, filename) {
	var root = parser.parse(src, filename);
	/* clear out the damn tokenizer for debugging */
	for (var k in root.tokenizer)
		delete root.tokenizer[k];
	try {
		// Don't want to create a global scope
		root.children.forEach(stmt);
	}
	catch (e) {
		if (!(e instanceof Nope))
			throw e;
		if (e.node) {
			var node = e.node;
			var frag = "<unknown fragment>";
			if (node.start && node.end)
				frag = ">>>" + src.substring(node.start, node.end) + "<<<";
			var loc = filename + ":" + (node.lineno || "") + ": ";
			console.error(loc + frag);
		}
		throw e;
	}
	emit(src);
}
exports.flatten = flatten;

if (require.main === module) {
	var filename = process.argv[2];
	if (!filename) {
		console.error("Filename required.");
		process.exit(1);
	}
	flatten(fs.readFileSync(filename, 'UTF-8'), filename);
}

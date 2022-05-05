import test from 'ava';
import {h, render, Fragment} from 'preact';
import {Suspense} from 'preact/compat';
import * as assert from 'assert/strict';
import {signal, Signal, action, setStrict} from 'statin';
import {observer, isSSR, setSSR} from './src/index';

const browserEnv = require('browser-env');
browserEnv(['window', 'document', 'navigator']);

setStrict(false);

async function waitFor<T extends () => any>(
	fn: T,
	{timeout = 500, interval = 30}: {timeout?: number; interval?: number} = {}
): Promise<ReturnType<T>> {
	const timeoutTime = Date.now() + timeout;
	let lastError: any;

	while (Date.now() < timeoutTime) {
		await new Promise((resolve) => setTimeout(resolve, interval));
		try {
			return fn();
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError;
}

test.serial('observe() makes component reactive', async (t) => {
	const container = document.createElement('div');
	const a = signal('foo');

	const RenderSignal = observer(function RenderSignal({signal}: {signal: Signal<string>}) {
		return <Fragment>{signal()}</Fragment>;
	});

	render(<RenderSignal signal={a} />, container);

	await waitFor(() => assert.equal(container.innerHTML, 'foo'));

	a('bar');

	await waitFor(() => assert.equal(container.innerHTML, 'bar'));

	t.pass();
});

test.serial('observe() isolates re-renders to current component', async (t) => {
	const container = document.createElement('div');
	const a = signal('foo');
	const b = signal('foo');
	const rerenders: Record<string, number> = {};

	const RenderSignal = observer(function RenderSignal({name, signal}: {name: string; signal: Signal<string>}) {
		rerenders[name] = (rerenders[name] || 0) + 1;
		return <Fragment>{signal()}</Fragment>;
	});

	render(
		<Fragment>
			<RenderSignal name="a" signal={a} />
			<RenderSignal name="b" signal={b} />
		</Fragment>,
		container
	);

	await waitFor(() => assert.equal(container.innerHTML, 'foofoo'));

	a('bar');

	await waitFor(() => assert.equal(container.innerHTML, 'barfoo'));

	t.is(rerenders.a, 2);
	t.is(rerenders.b, 1);
});

test.serial('observe() isolates re-renders to current nested component', async (t) => {
	const container = document.createElement('div');
	const a = signal('foo');
	const aName = signal('a');
	const b = signal('foo');
	const bName = signal('b');
	const rerenders: Record<string, number> = {};

	const RenderSignal = observer(function RenderSignal({name, signal}: {name: string; signal: Signal<string>}) {
		rerenders[name] = (rerenders[name] || 0) + 1;
		return <Fragment>{signal()}</Fragment>;
	});

	const NameSignal = observer(function NameSignal({
		name: nameSignal,
		signal,
	}: {
		name: Signal<string>;
		signal: Signal<string>;
	}) {
		const name = nameSignal();
		rerenders[name] = (rerenders[name] || 0) + 1;
		return (
			<Fragment>
				{name}:<RenderSignal name={`${name}Signal`} signal={signal} />,
			</Fragment>
		);
	});

	render(
		<Fragment>
			<NameSignal name={aName} signal={a} />
			<NameSignal name={bName} signal={b} />
		</Fragment>,
		container
	);

	await waitFor(() => assert.equal(container.innerHTML, 'a:foo,b:foo,'));

	action(() => {
		a('bar');
		bName('bb');
	});

	await waitFor(() => assert.equal(container.innerHTML, 'a:bar,bb:foo,'));

	t.is(rerenders.a, 1);
	t.is(rerenders.aSignal, 2);
	t.is(rerenders.b, 1);
	t.is(rerenders.bb, 1);
	t.is(rerenders.bSignal, 1);
});

test.serial('observe() caches, logs, and renders the error in place of a component', async (t) => {
	const container = document.createElement('div');

	const Thrower = observer(
		function Thrower() {
			throw new Error('MyFooError');
		},
		{
			onError: (error) => {
				t.is((error as any)?.message, 'MyFooError');
			},
		}
	);

	t.plan(1);

	render(<Thrower />, container);

	await waitFor(() => assert.ok(container.innerHTML === ''));
});

test.serial('observe() catches even falsy error payloads', async (t) => {
	const container = document.createElement('div');

	const Thrower = observer(
		function Thrower() {
			throw false;
		},
		{
			onError: (error) => {
				t.is(error, false);
			},
		}
	);

	t.plan(1);

	render(<Thrower />, container);
	await waitFor(() => assert.ok(container.innerHTML === ''));
});

test.serial('observe() recovers from errors', async (t) => {
	const container = document.createElement('div');
	const doThrow = signal(true);

	const Thrower = observer(
		function Thrower({throwSignal}: {throwSignal: Signal<boolean>}) {
			if (throwSignal()) throw new Error('MyFooError');
			return <Fragment>success</Fragment>;
		},
		{
			onError: (error) => {
				t.is((error as any)?.message, 'MyFooError');
			},
		}
	);

	t.plan(1);

	render(<Thrower throwSignal={doThrow} />, container);

	await waitFor(() => assert.ok(container.innerHTML === ''));

	doThrow(false);

	await waitFor(() => assert.equal(container.innerHTML, 'success'));
});

test.serial('observe() supports Suspense by re-throwing promises', async (t) => {
	const container = document.createElement('div');
	let isLoading = true;
	let resolve: () => void;
	const promise = new Promise<void>((_resolve) => {
		resolve = () => {
			isLoading = false;
			_resolve();
		};
	});

	const Thrower = observer(
		function Thrower() {
			if (isLoading) throw promise;
			return <Fragment>success</Fragment>;
		},
		{
			onError: () => {
				t.fail();
			},
		}
	);

	t.plan(1);

	render(
		<Suspense fallback={<Fragment>loading</Fragment>}>
			<Thrower />
		</Suspense>,
		container
	);
	await waitFor(() => assert.ok(container.innerHTML === 'loading'));
	resolve!();
	await waitFor(() => assert.ok(container.innerHTML === 'success'));

	t.pass();
});

test.serial('setSSR() should enable server side rendering mode', (t) => {
	t.is(isSSR(), false);
	setSSR(true);
	t.is(isSSR(), true);
	setSSR(false);
});

test.serial('observe() should simply return the component when SSR is enabled', async (t) => {
	setSSR(true);
	const Component = () => null;
	t.is(observer(Component), Component);
	setSSR(false);
	t.not(observer(Component), Component);
});

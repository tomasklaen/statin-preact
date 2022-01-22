# statin-preact

Preact bindings for [statin](https://github.com/tomasklaen/statin) reactive state library.

Only function components are supported.

## Install

```
npm install statin-preact
```

## Usage

Exports a single `observer()` function to wrap your reactive components with:

```tsx
import {h, render} from 'preact';
import {Signal, signal, computed, reaction} from 'statin';
import {observer} from 'statin-preact';

// Create a signal
const seconds = signal(4);

// Create a reactive component
const Counter = observer(function Counter({signal}: {signal: Signal<number>}) {
	return <div>Count is: {signal()}</div>;
});

// Render the component
render(<Counter signal={seconds} />, document.body);

// Update the signal
setInterval(
	createAction(() => seconds(seconds() + 1)),
	1000
);
```

## Examples

TodoMVC using preact, statin, and [poutr](https://github.com/tomasklaen/poutr): https://codesandbox.io/s/todomvc-preact-statin-poutr-b1s45

## API

Everything exported by the module:

### observer

```ts
interface ObserverOptions {
	onError?: (error: unknown) => void;
}

function observer(component: FunctionComponent, options?: ObserverOptions): FunctionComponent;
```

Accepts a function component and wraps it to make it reactive.

This component will re-render any time any of the statin signals used inside it changes.

In case the wrapped component throws an error, observer will render `null`, and either pass the error to the `onError` listener, or log it to the console.

If any signal used before the error was thrown changes, the `observer()` will try re-rendering the component again, providing error recovery.

##### Debugging

To know where your errors are coming from, simply name the components by naming their functions:

```tsx
const Foo = observer(function Foo() {});
// this names the component ---^
```

Apart of providing more descriptive errors, these function names also get automatically removed when minifying the code for production, which makes your bundle smaller with no extra effort.

If you don't want them to get removed, you can always name the function by specifying its `displayName` property. You can use statin's `nameFn()` utility for that:

```tsx
import {nameFn} from 'statin';
import {observer} from 'statin-preact';

const Foo = observer(nameFn('Foo', () => {}));
```

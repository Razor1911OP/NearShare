// The NearShare UI is plain JSX ported from the standalone repo; keep it
// untyped so it can be diffed/synced with the original source.
declare module "*.jsx" {
  const Component: any;
  export default Component;
}

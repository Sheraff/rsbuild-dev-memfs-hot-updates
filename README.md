# Rsbuild dev server: in-memory output file system keeps every hot-update file

`repro.mjs` starts `createRsbuild().startDevServer()` (no browser), rewrites `src/index.js` N times, waits for each
compilation, and lists the files in `compiler.outputFileSystem` (the dev middleware's memfs).

```sh
npm install
npm run repro                            # 200 edits
node repro.mjs --cycles=50 --rotate-chunk  # each edit also replaces a dynamic import with a new file
node repro.mjs --cycles=50 --rspack-clean  # control: tools.rspack.output.clean: true
```

Output with @rsbuild/core 2.2.14 / @rspack/core 2.2.9:

```
$ node repro.mjs --cycles=100
edits=   0 memfsFiles=   5 hotUpdateFiles=   0 memfsBytes=  0.1MB
edits=  50 memfsFiles= 155 hotUpdateFiles= 150 memfsBytes=  1.2MB
edits= 100 memfsFiles= 311 hotUpdateFiles= 306 memfsBytes=  2.3MB

$ node repro.mjs --cycles=50 --rspack-clean
edits=   0 memfsFiles=   5 hotUpdateFiles=   0 memfsBytes=  0.1MB
edits=  50 memfsFiles=   8 hotUpdateFiles=   3 memfsBytes=  0.2MB
```

Expected: a constant number of files without the `output.clean` override.

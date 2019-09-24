#!/usr/bin/env node

/* eslint-disable max-len, flowtype/require-valid-file-annotation, flowtype/require-return-type */
/* global packageInformationStores, null, $$SETUP_STATIC_TABLES */

// Used for the resolveUnqualified part of the resolution (ie resolving folder/index.js & file extensions)
// Deconstructed so that they aren't affected by any fs monkeypatching occuring later during the execution
const {statSync, lstatSync, readlinkSync, readFileSync, existsSync, realpathSync} = require('fs');

const Module = require('module');
const path = require('path');
const StringDecoder = require('string_decoder');

const ignorePattern = null ? new RegExp(null) : null;

const pnpFile = path.resolve(__dirname, __filename);
const builtinModules = new Set(Module.builtinModules || Object.keys(process.binding('natives')));

const topLevelLocator = {name: null, reference: null};
const blacklistedLocator = {name: NaN, reference: NaN};

// Used for compatibility purposes - cf setupCompatibilityLayer
const patchedModules = [];
const fallbackLocators = [topLevelLocator];

// Matches backslashes of Windows paths
const backwardSlashRegExp = /\\/g;

// Matches if the path must point to a directory (ie ends with /)
const isDirRegExp = /\/$/;

// Matches if the path starts with a valid path qualifier (./, ../, /)
// eslint-disable-next-line no-unused-vars
const isStrictRegExp = /^\.{0,2}\//;

// Splits a require request into its components, or return null if the request is a file path
const pathRegExp = /^(?![a-zA-Z]:[\\\/]|\\\\|\.{0,2}(?:\/|$))((?:@[^\/]+\/)?[^\/]+)\/?(.*|)$/;

// Keep a reference around ("module" is a common name in this context, so better rename it to something more significant)
const pnpModule = module;

/**
 * Used to disable the resolution hooks (for when we want to fallback to the previous resolution - we then need
 * a way to "reset" the environment temporarily)
 */

let enableNativeHooks = true;

/**
 * Simple helper function that assign an error code to an error, so that it can more easily be caught and used
 * by third-parties.
 */

function makeError(code, message, data = {}) {
  const error = new Error(message);
  return Object.assign(error, {code, data});
}

/**
 * Ensures that the returned locator isn't a blacklisted one.
 *
 * Blacklisted packages are packages that cannot be used because their dependencies cannot be deduced. This only
 * happens with peer dependencies, which effectively have different sets of dependencies depending on their parents.
 *
 * In order to deambiguate those different sets of dependencies, the Yarn implementation of PnP will generate a
 * symlink for each combination of <package name>/<package version>/<dependent package> it will find, and will
 * blacklist the target of those symlinks. By doing this, we ensure that files loaded through a specific path
 * will always have the same set of dependencies, provided the symlinks are correctly preserved.
 *
 * Unfortunately, some tools do not preserve them, and when it happens PnP isn't able anymore to deduce the set of
 * dependencies based on the path of the file that makes the require calls. But since we've blacklisted those paths,
 * we're able to print a more helpful error message that points out that a third-party package is doing something
 * incompatible!
 */

// eslint-disable-next-line no-unused-vars
function blacklistCheck(locator) {
  if (locator === blacklistedLocator) {
    throw makeError(
      `BLACKLISTED`,
      [
        `A package has been resolved through a blacklisted path - this is usually caused by one of your tools calling`,
        `"realpath" on the return value of "require.resolve". Since the returned values use symlinks to disambiguate`,
        `peer dependencies, they must be passed untransformed to "require".`,
      ].join(` `)
    );
  }

  return locator;
}

let packageInformationStores = new Map([
  ["body-parser", new Map([
    ["1.9.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-body-parser-1.9.0-95d72943b1a4f67f56bbac9e0dcc837b68703605/node_modules/body-parser/"),
      packageDependencies: new Map([
        ["bytes", "1.0.0"],
        ["depd", "1.0.1"],
        ["iconv-lite", "0.4.4"],
        ["media-typer", "0.3.0"],
        ["on-finished", "2.1.0"],
        ["qs", "2.2.4"],
        ["raw-body", "1.3.0"],
        ["type-is", "1.5.7"],
        ["body-parser", "1.9.0"],
      ]),
    }],
  ])],
  ["bytes", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-bytes-1.0.0-3569ede8ba34315fab99c3e92cb04c7220de1fa8/node_modules/bytes/"),
      packageDependencies: new Map([
        ["bytes", "1.0.0"],
      ]),
    }],
  ])],
  ["depd", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-depd-1.0.1-80aec64c9d6d97e65cc2a9caa93c0aa6abf73aaa/node_modules/depd/"),
      packageDependencies: new Map([
        ["depd", "1.0.1"],
      ]),
    }],
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-depd-1.1.2-9bcd52e14c097763e749b274c4346ed2e560b5a9/node_modules/depd/"),
      packageDependencies: new Map([
        ["depd", "1.1.2"],
      ]),
    }],
  ])],
  ["iconv-lite", new Map([
    ["0.4.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-iconv-lite-0.4.4-e95f2e41db0735fc21652f7827a5ee32e63c83a8/node_modules/iconv-lite/"),
      packageDependencies: new Map([
        ["iconv-lite", "0.4.4"],
      ]),
    }],
  ])],
  ["media-typer", new Map([
    ["0.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-media-typer-0.3.0-8710d7af0aa626f8fffa1ce00168545263255748/node_modules/media-typer/"),
      packageDependencies: new Map([
        ["media-typer", "0.3.0"],
      ]),
    }],
  ])],
  ["on-finished", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-on-finished-2.1.0-0c539f09291e8ffadde0c8a25850fb2cedc7022d/node_modules/on-finished/"),
      packageDependencies: new Map([
        ["ee-first", "1.0.5"],
        ["on-finished", "2.1.0"],
      ]),
    }],
    ["2.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-on-finished-2.2.1-5c85c1cc36299f78029653f667f27b6b99ebc029/node_modules/on-finished/"),
      packageDependencies: new Map([
        ["ee-first", "1.1.0"],
        ["on-finished", "2.2.1"],
      ]),
    }],
    ["2.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-on-finished-2.3.0-20f1336481b083cd75337992a16971aa2d906947/node_modules/on-finished/"),
      packageDependencies: new Map([
        ["ee-first", "1.1.1"],
        ["on-finished", "2.3.0"],
      ]),
    }],
  ])],
  ["ee-first", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ee-first-1.0.5-8c9b212898d8cd9f1a9436650ce7be202c9e9ff0/node_modules/ee-first/"),
      packageDependencies: new Map([
        ["ee-first", "1.0.5"],
      ]),
    }],
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ee-first-1.1.0-6a0d7c6221e490feefd92ec3f441c9ce8cd097f4/node_modules/ee-first/"),
      packageDependencies: new Map([
        ["ee-first", "1.1.0"],
      ]),
    }],
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ee-first-1.1.1-590c61156b0ae2f4f0255732a158b266bc56b21d/node_modules/ee-first/"),
      packageDependencies: new Map([
        ["ee-first", "1.1.1"],
      ]),
    }],
  ])],
  ["qs", new Map([
    ["2.2.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-qs-2.2.4-2e9fbcd34b540e3421c924ecd01e90aa975319c8/node_modules/qs/"),
      packageDependencies: new Map([
        ["qs", "2.2.4"],
      ]),
    }],
    ["2.4.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-qs-2.4.2-f7ce788e5777df0b5010da7f7c4e73ba32470f5a/node_modules/qs/"),
      packageDependencies: new Map([
        ["qs", "2.4.2"],
      ]),
    }],
    ["1.2.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-qs-1.2.2-19b57ff24dc2a99ce1f8bdf6afcda59f8ef61f88/node_modules/qs/"),
      packageDependencies: new Map([
        ["qs", "1.2.2"],
      ]),
    }],
    ["6.3.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-qs-6.3.2-e75bd5f6e268122a2a0e0bda630b2550c166502c/node_modules/qs/"),
      packageDependencies: new Map([
        ["qs", "6.3.2"],
      ]),
    }],
  ])],
  ["raw-body", new Map([
    ["1.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-raw-body-1.3.0-978230a156a5548f42eef14de22d0f4f610083d1/node_modules/raw-body/"),
      packageDependencies: new Map([
        ["bytes", "1.0.0"],
        ["iconv-lite", "0.4.4"],
        ["raw-body", "1.3.0"],
      ]),
    }],
  ])],
  ["type-is", new Map([
    ["1.5.7", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-type-is-1.5.7-b9368a593cc6ef7d0645e78b2f4c64cbecd05e90/node_modules/type-is/"),
      packageDependencies: new Map([
        ["media-typer", "0.3.0"],
        ["mime-types", "2.0.14"],
        ["type-is", "1.5.7"],
      ]),
    }],
    ["1.6.18", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-type-is-1.6.18-4e552cd05df09467dcbc4ef739de89f2cf37c131/node_modules/type-is/"),
      packageDependencies: new Map([
        ["media-typer", "0.3.0"],
        ["mime-types", "2.1.24"],
        ["type-is", "1.6.18"],
      ]),
    }],
  ])],
  ["mime-types", new Map([
    ["2.0.14", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-mime-types-2.0.14-310e159db23e077f8bb22b748dabfa4957140aa6/node_modules/mime-types/"),
      packageDependencies: new Map([
        ["mime-db", "1.12.0"],
        ["mime-types", "2.0.14"],
      ]),
    }],
    ["2.1.24", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-mime-types-2.1.24-b6f8d0b3e951efb77dedeca194cff6d16f676f81/node_modules/mime-types/"),
      packageDependencies: new Map([
        ["mime-db", "1.40.0"],
        ["mime-types", "2.1.24"],
      ]),
    }],
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-mime-types-1.0.2-995ae1392ab8affcbfcb2641dd054e943c0d5dce/node_modules/mime-types/"),
      packageDependencies: new Map([
        ["mime-types", "1.0.2"],
      ]),
    }],
  ])],
  ["mime-db", new Map([
    ["1.12.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-mime-db-1.12.0-3d0c63180f458eb10d325aaa37d7c58ae312e9d7/node_modules/mime-db/"),
      packageDependencies: new Map([
        ["mime-db", "1.12.0"],
      ]),
    }],
    ["1.40.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-mime-db-1.40.0-a65057e998db090f732a68f6c276d387d4126c32/node_modules/mime-db/"),
      packageDependencies: new Map([
        ["mime-db", "1.40.0"],
      ]),
    }],
  ])],
  ["cookie-parser", new Map([
    ["1.3.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-cookie-parser-1.3.3-7e3a2c745f4b460d5a340e578a0baa5d7725fe37/node_modules/cookie-parser/"),
      packageDependencies: new Map([
        ["cookie", "0.1.2"],
        ["cookie-signature", "1.0.5"],
        ["cookie-parser", "1.3.3"],
      ]),
    }],
  ])],
  ["cookie", new Map([
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-cookie-0.1.2-72fec3d24e48a3432073d90c12642005061004b1/node_modules/cookie/"),
      packageDependencies: new Map([
        ["cookie", "0.1.2"],
      ]),
    }],
  ])],
  ["cookie-signature", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-cookie-signature-1.0.5-a122e3f1503eca0f5355795b0711bb2368d450f9/node_modules/cookie-signature/"),
      packageDependencies: new Map([
        ["cookie-signature", "1.0.5"],
      ]),
    }],
    ["1.0.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-cookie-signature-1.0.6-e303a882b342cc3ee8ca513a79999734dab3ae2c/node_modules/cookie-signature/"),
      packageDependencies: new Map([
        ["cookie-signature", "1.0.6"],
      ]),
    }],
  ])],
  ["ejs", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ejs-1.0.0-c9c60a48a46ee452fb32a71c317b95e5aa1fcb3d/node_modules/ejs/"),
      packageDependencies: new Map([
        ["ejs", "1.0.0"],
      ]),
    }],
    ["0.8.8", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ejs-0.8.8-ffdc56dcc35d02926dd50ad13439bbc54061d598/node_modules/ejs/"),
      packageDependencies: new Map([
        ["ejs", "0.8.8"],
      ]),
    }],
  ])],
  ["ejs-locals", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ejs-locals-1.0.2-b9b320ff6933154105fa0eed683ea64d678088ce/node_modules/ejs-locals/"),
      packageDependencies: new Map([
        ["ejs", "0.8.8"],
        ["ejs-locals", "1.0.2"],
      ]),
    }],
  ])],
  ["errorhandler", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-errorhandler-1.2.0-2f89db72c150580c65e8dd5180504f5b8a398bd9/node_modules/errorhandler/"),
      packageDependencies: new Map([
        ["accepts", "1.1.4"],
        ["escape-html", "1.0.1"],
        ["errorhandler", "1.2.0"],
      ]),
    }],
  ])],
  ["accepts", new Map([
    ["1.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-accepts-1.1.4-d71c96f7d41d0feda2c38cd14e8a27c04158df4a/node_modules/accepts/"),
      packageDependencies: new Map([
        ["mime-types", "2.0.14"],
        ["negotiator", "0.4.9"],
        ["accepts", "1.1.4"],
      ]),
    }],
    ["1.2.13", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-accepts-1.2.13-e5f1f3928c6d95fd96558c36ec3d9d0de4a6ecea/node_modules/accepts/"),
      packageDependencies: new Map([
        ["mime-types", "2.1.24"],
        ["negotiator", "0.5.3"],
        ["accepts", "1.2.13"],
      ]),
    }],
  ])],
  ["negotiator", new Map([
    ["0.4.9", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-negotiator-0.4.9-92e46b6db53c7e421ed64a2bc94f08be7630df3f/node_modules/negotiator/"),
      packageDependencies: new Map([
        ["negotiator", "0.4.9"],
      ]),
    }],
    ["0.5.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-negotiator-0.5.3-269d5c476810ec92edbe7b6c2f28316384f9a7e8/node_modules/negotiator/"),
      packageDependencies: new Map([
        ["negotiator", "0.5.3"],
      ]),
    }],
    ["0.2.8", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-negotiator-0.2.8-adfd207a3875c4d37095729c2e7c283c5ba2ee72/node_modules/negotiator/"),
      packageDependencies: new Map([
        ["negotiator", "0.2.8"],
      ]),
    }],
  ])],
  ["escape-html", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-escape-html-1.0.1-181a286ead397a39a92857cfb1d43052e356bff0/node_modules/escape-html/"),
      packageDependencies: new Map([
        ["escape-html", "1.0.1"],
      ]),
    }],
  ])],
  ["express", new Map([
    ["4.12.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-express-4.12.4-8fec2510255bc6b2e58107c48239c0fa307c1aa2/node_modules/express/"),
      packageDependencies: new Map([
        ["accepts", "1.2.13"],
        ["content-disposition", "0.5.0"],
        ["content-type", "1.0.4"],
        ["cookie", "0.1.2"],
        ["cookie-signature", "1.0.6"],
        ["debug", "2.2.0"],
        ["depd", "1.0.1"],
        ["escape-html", "1.0.1"],
        ["etag", "1.6.0"],
        ["finalhandler", "0.3.6"],
        ["fresh", "0.2.4"],
        ["merge-descriptors", "1.0.0"],
        ["methods", "1.1.2"],
        ["on-finished", "2.2.1"],
        ["parseurl", "1.3.3"],
        ["path-to-regexp", "0.1.3"],
        ["proxy-addr", "1.0.10"],
        ["qs", "2.4.2"],
        ["range-parser", "1.0.3"],
        ["send", "0.12.3"],
        ["serve-static", "1.9.3"],
        ["type-is", "1.6.18"],
        ["utils-merge", "1.0.0"],
        ["vary", "1.0.1"],
        ["express", "4.12.4"],
      ]),
    }],
  ])],
  ["content-disposition", new Map([
    ["0.5.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-content-disposition-0.5.0-4284fe6ae0630874639e44e80a418c2934135e9e/node_modules/content-disposition/"),
      packageDependencies: new Map([
        ["content-disposition", "0.5.0"],
      ]),
    }],
  ])],
  ["content-type", new Map([
    ["1.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-content-type-1.0.4-e138cc75e040c727b1966fe5e5f8c9aee256fe3b/node_modules/content-type/"),
      packageDependencies: new Map([
        ["content-type", "1.0.4"],
      ]),
    }],
  ])],
  ["debug", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-debug-2.2.0-f87057e995b1a1f6ae6a4960664137bc56f039da/node_modules/debug/"),
      packageDependencies: new Map([
        ["ms", "0.7.1"],
        ["debug", "2.2.0"],
      ]),
    }],
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-debug-3.1.0-5bb5a0672628b64149566ba16819e61518c67261/node_modules/debug/"),
      packageDependencies: new Map([
        ["ms", "2.0.0"],
        ["debug", "3.1.0"],
      ]),
    }],
    ["2.6.9", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-debug-2.6.9-5d128515df134ff327e90a4c93f4e077a536341f/node_modules/debug/"),
      packageDependencies: new Map([
        ["ms", "2.0.0"],
        ["debug", "2.6.9"],
      ]),
    }],
  ])],
  ["ms", new Map([
    ["0.7.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ms-0.7.1-9cd13c03adbff25b65effde7ce864ee952017098/node_modules/ms/"),
      packageDependencies: new Map([
        ["ms", "0.7.1"],
      ]),
    }],
    ["0.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ms-0.6.2-d89c2124c6fdc1353d65a8b77bf1aac4b193708c/node_modules/ms/"),
      packageDependencies: new Map([
        ["ms", "0.6.2"],
      ]),
    }],
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ms-2.0.0-5608aeadfc00be6c2901df5f9861788de0d597c8/node_modules/ms/"),
      packageDependencies: new Map([
        ["ms", "2.0.0"],
      ]),
    }],
    ["0.7.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ms-0.7.3-708155a5e44e33f5fd0fc53e81d0d40a91be1fff/node_modules/ms/"),
      packageDependencies: new Map([
        ["ms", "0.7.3"],
      ]),
    }],
  ])],
  ["etag", new Map([
    ["1.6.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-etag-1.6.0-8bcb2c6af1254c481dfc8b997c906ef4e442c207/node_modules/etag/"),
      packageDependencies: new Map([
        ["crc", "3.2.1"],
        ["etag", "1.6.0"],
      ]),
    }],
  ])],
  ["crc", new Map([
    ["3.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-crc-3.2.1-5d9c8fb77a245cd5eca291e5d2d005334bab0082/node_modules/crc/"),
      packageDependencies: new Map([
        ["crc", "3.2.1"],
      ]),
    }],
  ])],
  ["finalhandler", new Map([
    ["0.3.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-finalhandler-0.3.6-daf9c4161b1b06e001466b1411dfdb6973be138b/node_modules/finalhandler/"),
      packageDependencies: new Map([
        ["debug", "2.2.0"],
        ["escape-html", "1.0.1"],
        ["on-finished", "2.2.1"],
        ["finalhandler", "0.3.6"],
      ]),
    }],
  ])],
  ["fresh", new Map([
    ["0.2.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-fresh-0.2.4-3582499206c9723714190edd74b4604feb4a614c/node_modules/fresh/"),
      packageDependencies: new Map([
        ["fresh", "0.2.4"],
      ]),
    }],
  ])],
  ["merge-descriptors", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-merge-descriptors-1.0.0-2169cf7538e1b0cc87fb88e1502d8474bbf79864/node_modules/merge-descriptors/"),
      packageDependencies: new Map([
        ["merge-descriptors", "1.0.0"],
      ]),
    }],
  ])],
  ["methods", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-methods-1.1.2-5529a4d67654134edcc5266656835b0f851afcee/node_modules/methods/"),
      packageDependencies: new Map([
        ["methods", "1.1.2"],
      ]),
    }],
  ])],
  ["parseurl", new Map([
    ["1.3.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-parseurl-1.3.3-9da19e7bee8d12dff0513ed5b76957793bc2e8d4/node_modules/parseurl/"),
      packageDependencies: new Map([
        ["parseurl", "1.3.3"],
      ]),
    }],
  ])],
  ["path-to-regexp", new Map([
    ["0.1.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-path-to-regexp-0.1.3-21b9ab82274279de25b156ea08fd12ca51b8aecb/node_modules/path-to-regexp/"),
      packageDependencies: new Map([
        ["path-to-regexp", "0.1.3"],
      ]),
    }],
  ])],
  ["proxy-addr", new Map([
    ["1.0.10", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-proxy-addr-1.0.10-0d40a82f801fc355567d2ecb65efe3f077f121c5/node_modules/proxy-addr/"),
      packageDependencies: new Map([
        ["forwarded", "0.1.2"],
        ["ipaddr.js", "1.0.5"],
        ["proxy-addr", "1.0.10"],
      ]),
    }],
  ])],
  ["forwarded", new Map([
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-forwarded-0.1.2-98c23dab1175657b8c0573e8ceccd91b0ff18c84/node_modules/forwarded/"),
      packageDependencies: new Map([
        ["forwarded", "0.1.2"],
      ]),
    }],
  ])],
  ["ipaddr.js", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ipaddr-js-1.0.5-5fa78cf301b825c78abc3042d812723049ea23c7/node_modules/ipaddr.js/"),
      packageDependencies: new Map([
        ["ipaddr.js", "1.0.5"],
      ]),
    }],
  ])],
  ["range-parser", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-range-parser-1.0.3-6872823535c692e2c2a0103826afd82c2e0ff175/node_modules/range-parser/"),
      packageDependencies: new Map([
        ["range-parser", "1.0.3"],
      ]),
    }],
  ])],
  ["send", new Map([
    ["0.12.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-send-0.12.3-cd12dc58fde21e4f91902b39b2fda05a7a6d9bdc/node_modules/send/"),
      packageDependencies: new Map([
        ["debug", "2.2.0"],
        ["depd", "1.0.1"],
        ["destroy", "1.0.3"],
        ["escape-html", "1.0.1"],
        ["etag", "1.6.0"],
        ["fresh", "0.2.4"],
        ["mime", "1.3.4"],
        ["ms", "0.7.1"],
        ["on-finished", "2.2.1"],
        ["range-parser", "1.0.3"],
        ["send", "0.12.3"],
      ]),
    }],
  ])],
  ["destroy", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-destroy-1.0.3-b433b4724e71fd8551d9885174851c5fc377e2c9/node_modules/destroy/"),
      packageDependencies: new Map([
        ["destroy", "1.0.3"],
      ]),
    }],
  ])],
  ["mime", new Map([
    ["1.3.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-mime-1.3.4-115f9e3b6b3daf2959983cb38f149a2d40eb5d53/node_modules/mime/"),
      packageDependencies: new Map([
        ["mime", "1.3.4"],
      ]),
    }],
    ["1.2.11", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-mime-1.2.11-58203eed86e3a5ef17aed2b7d9ebd47f0a60dd10/node_modules/mime/"),
      packageDependencies: new Map([
        ["mime", "1.2.11"],
      ]),
    }],
  ])],
  ["serve-static", new Map([
    ["1.9.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-serve-static-1.9.3-5f8da07323ad385ff3dc541f1a7917b2e436eb57/node_modules/serve-static/"),
      packageDependencies: new Map([
        ["escape-html", "1.0.1"],
        ["parseurl", "1.3.3"],
        ["send", "0.12.3"],
        ["utils-merge", "1.0.0"],
        ["serve-static", "1.9.3"],
      ]),
    }],
  ])],
  ["utils-merge", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-utils-merge-1.0.0-0294fb922bb9375153541c4f7096231f287c8af8/node_modules/utils-merge/"),
      packageDependencies: new Map([
        ["utils-merge", "1.0.0"],
      ]),
    }],
  ])],
  ["vary", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-vary-1.0.1-99e4981566a286118dfb2b817357df7993376d10/node_modules/vary/"),
      packageDependencies: new Map([
        ["vary", "1.0.1"],
      ]),
    }],
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-vary-1.1.2-2299f02c6ded30d4a5961b0b9f74524a18f634fc/node_modules/vary/"),
      packageDependencies: new Map([
        ["vary", "1.1.2"],
      ]),
    }],
  ])],
  ["express-fileupload", new Map([
    ["0.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-express-fileupload-0.0.5-433a712525afa98b4c93162522e8bf79c68d82e7/node_modules/express-fileupload/"),
      packageDependencies: new Map([
        ["connect-busboy", "0.0.2"],
        ["fs-extra", "0.22.1"],
        ["streamifier", "0.1.1"],
        ["express-fileupload", "0.0.5"],
      ]),
    }],
  ])],
  ["connect-busboy", new Map([
    ["0.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-connect-busboy-0.0.2-ac5c9c96672171885e576c66b2bfd95d3bb11097/node_modules/connect-busboy/"),
      packageDependencies: new Map([
        ["busboy", "0.3.1"],
        ["connect-busboy", "0.0.2"],
      ]),
    }],
  ])],
  ["busboy", new Map([
    ["0.3.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-busboy-0.3.1-170899274c5bf38aae27d5c62b71268cd585fd1b/node_modules/busboy/"),
      packageDependencies: new Map([
        ["dicer", "0.3.0"],
        ["busboy", "0.3.1"],
      ]),
    }],
  ])],
  ["dicer", new Map([
    ["0.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-dicer-0.3.0-eacd98b3bfbf92e8ab5c2fdb71aaac44bb06b872/node_modules/dicer/"),
      packageDependencies: new Map([
        ["streamsearch", "0.1.2"],
        ["dicer", "0.3.0"],
      ]),
    }],
  ])],
  ["streamsearch", new Map([
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-streamsearch-0.1.2-808b9d0e56fc273d809ba57338e929919a1a9f1a/node_modules/streamsearch/"),
      packageDependencies: new Map([
        ["streamsearch", "0.1.2"],
      ]),
    }],
  ])],
  ["fs-extra", new Map([
    ["0.22.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-fs-extra-0.22.1-5fd6f8049dc976ca19eb2355d658173cabcce056/node_modules/fs-extra/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.2"],
        ["jsonfile", "2.4.0"],
        ["rimraf", "2.7.1"],
        ["fs-extra", "0.22.1"],
      ]),
    }],
  ])],
  ["graceful-fs", new Map([
    ["4.2.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-graceful-fs-4.2.2-6f0952605d0140c1cfdb138ed005775b92d67b02/node_modules/graceful-fs/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.2"],
      ]),
    }],
    ["1.2.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-graceful-fs-1.2.3-15a4806a57547cb2d2dbf27f42e89a8c3451b364/node_modules/graceful-fs/"),
      packageDependencies: new Map([
        ["graceful-fs", "1.2.3"],
      ]),
    }],
  ])],
  ["jsonfile", new Map([
    ["2.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-jsonfile-2.4.0-3736a2b428b87bbda0cc83b53fa3d633a35c2ae8/node_modules/jsonfile/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.2"],
        ["jsonfile", "2.4.0"],
      ]),
    }],
  ])],
  ["rimraf", new Map([
    ["2.7.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-rimraf-2.7.1-35797f13a7fdadc566142c29d4f07ccad483e3ec/node_modules/rimraf/"),
      packageDependencies: new Map([
        ["glob", "7.1.4"],
        ["rimraf", "2.7.1"],
      ]),
    }],
  ])],
  ["glob", new Map([
    ["7.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-glob-7.1.4-aa608a2f6c577ad357e1ae5a5c26d9a8d1969255/node_modules/glob/"),
      packageDependencies: new Map([
        ["fs.realpath", "1.0.0"],
        ["inflight", "1.0.6"],
        ["inherits", "2.0.4"],
        ["minimatch", "3.0.4"],
        ["once", "1.4.0"],
        ["path-is-absolute", "1.0.1"],
        ["glob", "7.1.4"],
      ]),
    }],
    ["5.0.15", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-glob-5.0.15-1bc936b9e02f4a603fcc222ecf7633d30b8b93b1/node_modules/glob/"),
      packageDependencies: new Map([
        ["inflight", "1.0.6"],
        ["inherits", "2.0.4"],
        ["minimatch", "3.0.4"],
        ["once", "1.4.0"],
        ["path-is-absolute", "1.0.1"],
        ["glob", "5.0.15"],
      ]),
    }],
  ])],
  ["fs.realpath", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-fs-realpath-1.0.0-1504ad2523158caa40db4a2787cb01411994ea4f/node_modules/fs.realpath/"),
      packageDependencies: new Map([
        ["fs.realpath", "1.0.0"],
      ]),
    }],
  ])],
  ["inflight", new Map([
    ["1.0.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-inflight-1.0.6-49bd6331d7d02d0c09bc910a1075ba8165b56df9/node_modules/inflight/"),
      packageDependencies: new Map([
        ["once", "1.4.0"],
        ["wrappy", "1.0.2"],
        ["inflight", "1.0.6"],
      ]),
    }],
  ])],
  ["once", new Map([
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-once-1.4.0-583b1aa775961d4b113ac17d9c50baef9dd76bd1/node_modules/once/"),
      packageDependencies: new Map([
        ["wrappy", "1.0.2"],
        ["once", "1.4.0"],
      ]),
    }],
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-once-1.1.1-9db574933ccb08c3a7614d154032c09ea6f339e7/node_modules/once/"),
      packageDependencies: new Map([
        ["once", "1.1.1"],
      ]),
    }],
  ])],
  ["wrappy", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-wrappy-1.0.2-b5243d8f3ec1aa35f1364605bc0d1036e30ab69f/node_modules/wrappy/"),
      packageDependencies: new Map([
        ["wrappy", "1.0.2"],
      ]),
    }],
  ])],
  ["inherits", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-inherits-2.0.4-0fa2c64f932917c3433a0ded55363aae37416b7c/node_modules/inherits/"),
      packageDependencies: new Map([
        ["inherits", "2.0.4"],
      ]),
    }],
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-inherits-1.0.2-ca4309dadee6b54cc0b8d247e8d7c7a0975bdc9b/node_modules/inherits/"),
      packageDependencies: new Map([
        ["inherits", "1.0.2"],
      ]),
    }],
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-inherits-2.0.1-b17d08d326b4423e568eff719f91b0b1cbdf69f1/node_modules/inherits/"),
      packageDependencies: new Map([
        ["inherits", "2.0.1"],
      ]),
    }],
    ["2.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-inherits-2.0.3-633c2c83e3da42a502f52466022480f4208261de/node_modules/inherits/"),
      packageDependencies: new Map([
        ["inherits", "2.0.3"],
      ]),
    }],
  ])],
  ["minimatch", new Map([
    ["3.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-minimatch-3.0.4-5166e286457f03306064be5497e8dbb0c3d32083/node_modules/minimatch/"),
      packageDependencies: new Map([
        ["brace-expansion", "1.1.11"],
        ["minimatch", "3.0.4"],
      ]),
    }],
  ])],
  ["brace-expansion", new Map([
    ["1.1.11", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-brace-expansion-1.1.11-3c7fcbf529d87226f3d2f52b966ff5271eb441dd/node_modules/brace-expansion/"),
      packageDependencies: new Map([
        ["balanced-match", "1.0.0"],
        ["concat-map", "0.0.1"],
        ["brace-expansion", "1.1.11"],
      ]),
    }],
  ])],
  ["balanced-match", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-balanced-match-1.0.0-89b4d199ab2bee49de164ea02b89ce462d71b767/node_modules/balanced-match/"),
      packageDependencies: new Map([
        ["balanced-match", "1.0.0"],
      ]),
    }],
  ])],
  ["concat-map", new Map([
    ["0.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-concat-map-0.0.1-d8a96bd77fd68df7793a73036a3ba0d5405d477b/node_modules/concat-map/"),
      packageDependencies: new Map([
        ["concat-map", "0.0.1"],
      ]),
    }],
  ])],
  ["path-is-absolute", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-path-is-absolute-1.0.1-174b9268735534ffbc7ace6bf53a5a9e1b5c5f5f/node_modules/path-is-absolute/"),
      packageDependencies: new Map([
        ["path-is-absolute", "1.0.1"],
      ]),
    }],
  ])],
  ["streamifier", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-streamifier-0.1.1-97e98d8fa4d105d62a2691d1dc07e820db8dfc4f/node_modules/streamifier/"),
      packageDependencies: new Map([
        ["streamifier", "0.1.1"],
      ]),
    }],
  ])],
  ["humanize-ms", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-humanize-ms-1.0.1-4336d3c4392236bb8e59cda599f6d88675dc5ff8/node_modules/humanize-ms/"),
      packageDependencies: new Map([
        ["ms", "0.6.2"],
        ["humanize-ms", "1.0.1"],
      ]),
    }],
  ])],
  ["jquery", new Map([
    ["2.2.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-jquery-2.2.4-2c89d6889b5eac522a7eea32c14521559c6cbf02/node_modules/jquery/"),
      packageDependencies: new Map([
        ["jquery", "2.2.4"],
      ]),
    }],
  ])],
  ["marked", new Map([
    ["0.3.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-marked-0.3.5-4113a15ac5d7bca158a5aae07224587b9fa15b94/node_modules/marked/"),
      packageDependencies: new Map([
        ["marked", "0.3.5"],
      ]),
    }],
  ])],
  ["method-override", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-method-override-3.0.0-6ab0d5d574e3208f15b0c9cf45ab52000468d7a2/node_modules/method-override/"),
      packageDependencies: new Map([
        ["debug", "3.1.0"],
        ["methods", "1.1.2"],
        ["parseurl", "1.3.3"],
        ["vary", "1.1.2"],
        ["method-override", "3.0.0"],
      ]),
    }],
  ])],
  ["moment", new Map([
    ["2.15.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-moment-2.15.1-e979c2a29e22888e60f396f2220a6118f85cd94c/node_modules/moment/"),
      packageDependencies: new Map([
        ["moment", "2.15.1"],
      ]),
    }],
  ])],
  ["mongoose", new Map([
    ["4.2.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-mongoose-4.2.4-e2f8c007dd838f6633b4f6c965ba92a232ac9317/node_modules/mongoose/"),
      packageDependencies: new Map([
        ["async", "0.9.0"],
        ["bson", "0.4.23"],
        ["hooks-fixed", "1.1.0"],
        ["kareem", "1.0.1"],
        ["mongodb", "2.0.46"],
        ["mpath", "0.1.1"],
        ["mpromise", "0.5.4"],
        ["mquery", "1.6.3"],
        ["ms", "0.7.1"],
        ["muri", "1.0.0"],
        ["regexp-clone", "0.0.1"],
        ["sliced", "0.0.5"],
        ["mongoose", "4.2.4"],
      ]),
    }],
  ])],
  ["async", new Map([
    ["0.9.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-async-0.9.0-ac3613b1da9bed1b47510bb4651b8931e47146c7/node_modules/async/"),
      packageDependencies: new Map([
        ["async", "0.9.0"],
      ]),
    }],
    ["0.9.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-async-0.9.2-aea74d5e61c1f899613bf64bda66d4c78f2fd17d/node_modules/async/"),
      packageDependencies: new Map([
        ["async", "0.9.2"],
      ]),
    }],
    ["1.5.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-async-1.5.2-ec6a61ae56480c0c3cb241c95618e20892f9672a/node_modules/async/"),
      packageDependencies: new Map([
        ["async", "1.5.2"],
      ]),
    }],
  ])],
  ["bson", new Map([
    ["0.4.23", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-bson-0.4.23-e65a2e3c7507ffade4109bc7575a76e50f8da915/node_modules/bson/"),
      packageDependencies: new Map([
        ["bson", "0.4.23"],
      ]),
    }],
  ])],
  ["hooks-fixed", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-hooks-fixed-1.1.0-0e8c15336708e6611185fe390b44687dd5230dbb/node_modules/hooks-fixed/"),
      packageDependencies: new Map([
        ["hooks-fixed", "1.1.0"],
      ]),
    }],
  ])],
  ["kareem", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-kareem-1.0.1-7805d215bb53214ec3af969a1d0b1f17e3e7b95c/node_modules/kareem/"),
      packageDependencies: new Map([
        ["kareem", "1.0.1"],
      ]),
    }],
  ])],
  ["mongodb", new Map([
    ["2.0.46", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-mongodb-2.0.46-b1b857465e45e259b1e0e033698341a64cb93559/node_modules/mongodb/"),
      packageDependencies: new Map([
        ["es6-promise", "2.1.1"],
        ["mongodb-core", "1.2.19"],
        ["readable-stream", "1.0.31"],
        ["mongodb", "2.0.46"],
      ]),
    }],
  ])],
  ["es6-promise", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-es6-promise-2.1.1-03e8f3c7297928e5478d6ab1d0643251507bdedd/node_modules/es6-promise/"),
      packageDependencies: new Map([
        ["es6-promise", "2.1.1"],
      ]),
    }],
  ])],
  ["mongodb-core", new Map([
    ["1.2.19", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-mongodb-core-1.2.19-fcb35f6b6abc5c3de1f1a4a5db526b9e306f3eb7/node_modules/mongodb-core/"),
      packageDependencies: new Map([
        ["bson", "0.4.23"],
        ["kerberos", "0.0.24"],
        ["mongodb-core", "1.2.19"],
      ]),
    }],
  ])],
  ["kerberos", new Map([
    ["0.0.24", {
      packageLocation: path.resolve(__dirname, "./.pnp/unplugged/npm-kerberos-0.0.24-67e5fe0f0dbe240a505eb45de411d6031e7b381b/node_modules/kerberos/"),
      packageDependencies: new Map([
        ["nan", "2.10.0"],
        ["kerberos", "0.0.24"],
      ]),
    }],
  ])],
  ["nan", new Map([
    ["2.10.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-nan-2.10.0-96d0cd610ebd58d4b4de9cc0c6828cda99c7548f/node_modules/nan/"),
      packageDependencies: new Map([
        ["nan", "2.10.0"],
      ]),
    }],
  ])],
  ["readable-stream", new Map([
    ["1.0.31", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-readable-stream-1.0.31-8f2502e0bc9e3b0da1b94520aabb4e2603ecafae/node_modules/readable-stream/"),
      packageDependencies: new Map([
        ["core-util-is", "1.0.2"],
        ["inherits", "2.0.4"],
        ["isarray", "0.0.1"],
        ["string_decoder", "0.10.31"],
        ["readable-stream", "1.0.31"],
      ]),
    }],
    ["1.0.34", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-readable-stream-1.0.34-125820e34bc842d2f2aaafafe4c2916ee32c157c/node_modules/readable-stream/"),
      packageDependencies: new Map([
        ["core-util-is", "1.0.2"],
        ["inherits", "2.0.4"],
        ["isarray", "0.0.1"],
        ["string_decoder", "0.10.31"],
        ["readable-stream", "1.0.34"],
      ]),
    }],
    ["2.3.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-readable-stream-2.3.6-b11c27d88b8ff1fbe070643cf94b0c79ae1b0aaf/node_modules/readable-stream/"),
      packageDependencies: new Map([
        ["core-util-is", "1.0.2"],
        ["inherits", "2.0.4"],
        ["isarray", "1.0.0"],
        ["process-nextick-args", "2.0.1"],
        ["safe-buffer", "5.1.2"],
        ["string_decoder", "1.1.1"],
        ["util-deprecate", "1.0.2"],
        ["readable-stream", "2.3.6"],
      ]),
    }],
    ["1.1.14", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-readable-stream-1.1.14-7cf4c54ef648e3813084c636dd2079e166c081d9/node_modules/readable-stream/"),
      packageDependencies: new Map([
        ["core-util-is", "1.0.2"],
        ["inherits", "2.0.4"],
        ["isarray", "0.0.1"],
        ["string_decoder", "0.10.31"],
        ["readable-stream", "1.1.14"],
      ]),
    }],
    ["2.0.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-readable-stream-2.0.6-8f90341e68a53ccc928788dacfcd11b36eb9b78e/node_modules/readable-stream/"),
      packageDependencies: new Map([
        ["core-util-is", "1.0.2"],
        ["inherits", "2.0.4"],
        ["isarray", "1.0.0"],
        ["process-nextick-args", "1.0.7"],
        ["string_decoder", "0.10.31"],
        ["util-deprecate", "1.0.2"],
        ["readable-stream", "2.0.6"],
      ]),
    }],
  ])],
  ["core-util-is", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-core-util-is-1.0.2-b5fd54220aa2bc5ab57aab7140c940754503c1a7/node_modules/core-util-is/"),
      packageDependencies: new Map([
        ["core-util-is", "1.0.2"],
      ]),
    }],
  ])],
  ["isarray", new Map([
    ["0.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-isarray-0.0.1-8a18acfca9a8f4177e09abfc6038939b05d1eedf/node_modules/isarray/"),
      packageDependencies: new Map([
        ["isarray", "0.0.1"],
      ]),
    }],
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-isarray-1.0.0-bb935d48582cba168c06834957a54a3e07124f11/node_modules/isarray/"),
      packageDependencies: new Map([
        ["isarray", "1.0.0"],
      ]),
    }],
  ])],
  ["string_decoder", new Map([
    ["0.10.31", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-string-decoder-0.10.31-62e203bc41766c6c28c9fc84301dab1c5310fa94/node_modules/string_decoder/"),
      packageDependencies: new Map([
        ["string_decoder", "0.10.31"],
      ]),
    }],
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-string-decoder-1.1.1-9cf1611ba62685d7030ae9e4ba34149c3af03fc8/node_modules/string_decoder/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.1.2"],
        ["string_decoder", "1.1.1"],
      ]),
    }],
  ])],
  ["mpath", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-mpath-0.1.1-23da852b7c232ee097f4759d29c0ee9cd22d5e46/node_modules/mpath/"),
      packageDependencies: new Map([
        ["mpath", "0.1.1"],
      ]),
    }],
  ])],
  ["mpromise", new Map([
    ["0.5.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-mpromise-0.5.4-b610613ec6de37419f944b35f0783b4de9f5dc75/node_modules/mpromise/"),
      packageDependencies: new Map([
        ["mpromise", "0.5.4"],
      ]),
    }],
  ])],
  ["mquery", new Map([
    ["1.6.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-mquery-1.6.3-7c02bfb7e49c8012cece1556c5e65fef61f3c8e5/node_modules/mquery/"),
      packageDependencies: new Map([
        ["bluebird", "2.9.26"],
        ["debug", "2.2.0"],
        ["regexp-clone", "0.0.1"],
        ["sliced", "0.0.5"],
        ["mquery", "1.6.3"],
      ]),
    }],
  ])],
  ["bluebird", new Map([
    ["2.9.26", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-bluebird-2.9.26-362772ea4d09f556a4b9f3b64c2fd136e87e3a55/node_modules/bluebird/"),
      packageDependencies: new Map([
        ["bluebird", "2.9.26"],
      ]),
    }],
    ["3.5.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-bluebird-3.5.5-a8d0afd73251effbbd5fe384a77d73003c17a71f/node_modules/bluebird/"),
      packageDependencies: new Map([
        ["bluebird", "3.5.5"],
      ]),
    }],
  ])],
  ["regexp-clone", new Map([
    ["0.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-regexp-clone-0.0.1-a7c2e09891fdbf38fbb10d376fb73003e68ac589/node_modules/regexp-clone/"),
      packageDependencies: new Map([
        ["regexp-clone", "0.0.1"],
      ]),
    }],
  ])],
  ["sliced", new Map([
    ["0.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-sliced-0.0.5-5edc044ca4eb6f7816d50ba2fc63e25d8fe4707f/node_modules/sliced/"),
      packageDependencies: new Map([
        ["sliced", "0.0.5"],
      ]),
    }],
  ])],
  ["muri", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-muri-1.0.0-de3bf6bd71d67eae71d76689b950d2de118695c6/node_modules/muri/"),
      packageDependencies: new Map([
        ["muri", "1.0.0"],
      ]),
    }],
  ])],
  ["morgan", new Map([
    ["1.9.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-morgan-1.9.1-0a8d16734a1d9afbc824b99df87e738e58e2da59/node_modules/morgan/"),
      packageDependencies: new Map([
        ["basic-auth", "2.0.1"],
        ["debug", "2.6.9"],
        ["depd", "1.1.2"],
        ["on-finished", "2.3.0"],
        ["on-headers", "1.0.2"],
        ["morgan", "1.9.1"],
      ]),
    }],
  ])],
  ["basic-auth", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-basic-auth-2.0.1-b998279bf47ce38344b4f3cf916d4679bbf51e3a/node_modules/basic-auth/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.1.2"],
        ["basic-auth", "2.0.1"],
      ]),
    }],
  ])],
  ["safe-buffer", new Map([
    ["5.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-safe-buffer-5.1.2-991ec69d296e0313747d59bdfd2b745c35f8828d/node_modules/safe-buffer/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.1.2"],
      ]),
    }],
    ["5.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-safe-buffer-5.2.0-b74daec49b1148f88c64b68d49b1e815c1f2f519/node_modules/safe-buffer/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.2.0"],
      ]),
    }],
  ])],
  ["on-headers", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-on-headers-1.0.2-772b0ae6aaa525c399e489adfad90c403eb3c28f/node_modules/on-headers/"),
      packageDependencies: new Map([
        ["on-headers", "1.0.2"],
      ]),
    }],
  ])],
  ["npmconf", new Map([
    ["0.0.24", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-npmconf-0.0.24-b78875b088ccc3c0afa3eceb3ce3244b1b52390c/node_modules/npmconf/"),
      packageDependencies: new Map([
        ["config-chain", "1.1.12"],
        ["inherits", "1.0.2"],
        ["ini", "1.1.0"],
        ["mkdirp", "0.3.5"],
        ["nopt", "2.2.1"],
        ["once", "1.1.1"],
        ["osenv", "0.0.3"],
        ["semver", "1.1.4"],
        ["npmconf", "0.0.24"],
      ]),
    }],
  ])],
  ["config-chain", new Map([
    ["1.1.12", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-config-chain-1.1.12-0fde8d091200eb5e808caf25fe618c02f48e4efa/node_modules/config-chain/"),
      packageDependencies: new Map([
        ["ini", "1.3.5"],
        ["proto-list", "1.2.4"],
        ["config-chain", "1.1.12"],
      ]),
    }],
  ])],
  ["ini", new Map([
    ["1.3.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ini-1.3.5-eee25f56db1c9ec6085e0c22778083f596abf927/node_modules/ini/"),
      packageDependencies: new Map([
        ["ini", "1.3.5"],
      ]),
    }],
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ini-1.1.0-4e808c2ce144c6c1788918e034d6797bc6cf6281/node_modules/ini/"),
      packageDependencies: new Map([
        ["ini", "1.1.0"],
      ]),
    }],
  ])],
  ["proto-list", new Map([
    ["1.2.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-proto-list-1.2.4-212d5bfe1318306a420f6402b8e26ff39647a849/node_modules/proto-list/"),
      packageDependencies: new Map([
        ["proto-list", "1.2.4"],
      ]),
    }],
  ])],
  ["mkdirp", new Map([
    ["0.3.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-mkdirp-0.3.5-de3e5f8961c88c787ee1368df849ac4413eca8d7/node_modules/mkdirp/"),
      packageDependencies: new Map([
        ["mkdirp", "0.3.5"],
      ]),
    }],
    ["0.5.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-mkdirp-0.5.1-30057438eac6cf7f8c4767f38648d6697d75c903/node_modules/mkdirp/"),
      packageDependencies: new Map([
        ["minimist", "0.0.8"],
        ["mkdirp", "0.5.1"],
      ]),
    }],
  ])],
  ["nopt", new Map([
    ["2.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-nopt-2.2.1-2aa09b7d1768487b3b89a9c5aa52335bff0baea7/node_modules/nopt/"),
      packageDependencies: new Map([
        ["abbrev", "1.1.1"],
        ["nopt", "2.2.1"],
      ]),
    }],
    ["3.0.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-nopt-3.0.6-c6465dbf08abcd4db359317f79ac68a646b28ff9/node_modules/nopt/"),
      packageDependencies: new Map([
        ["abbrev", "1.1.1"],
        ["nopt", "3.0.6"],
      ]),
    }],
  ])],
  ["abbrev", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-abbrev-1.1.1-f8f2c887ad10bf67f634f005b6987fed3179aac8/node_modules/abbrev/"),
      packageDependencies: new Map([
        ["abbrev", "1.1.1"],
      ]),
    }],
    ["1.0.9", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-abbrev-1.0.9-91b4792588a7738c25f35dd6f63752a2f8776135/node_modules/abbrev/"),
      packageDependencies: new Map([
        ["abbrev", "1.0.9"],
      ]),
    }],
  ])],
  ["osenv", new Map([
    ["0.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-osenv-0.0.3-cd6ad8ddb290915ad9e22765576025d411f29cb6/node_modules/osenv/"),
      packageDependencies: new Map([
        ["osenv", "0.0.3"],
      ]),
    }],
  ])],
  ["semver", new Map([
    ["1.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-semver-1.1.4-2e5a4e72bab03472cc97f72753b4508912ef5540/node_modules/semver/"),
      packageDependencies: new Map([
        ["semver", "1.1.4"],
      ]),
    }],
    ["5.7.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-semver-5.7.1-a954f931aeba508d307bbf069eff0c01c96116f7/node_modules/semver/"),
      packageDependencies: new Map([
        ["semver", "5.7.1"],
      ]),
    }],
  ])],
  ["optional", new Map([
    ["0.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-optional-0.1.4-cdb1a9bedc737d2025f690ceeb50e049444fd5b3/node_modules/optional/"),
      packageDependencies: new Map([
        ["optional", "0.1.4"],
      ]),
    }],
  ])],
  ["st", new Map([
    ["0.2.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-st-0.2.4-97318f55485ffcbe7086e22b40d61758923cffa0/node_modules/st/"),
      packageDependencies: new Map([
        ["async-cache", "0.1.5"],
        ["fd", "0.0.3"],
        ["mime", "1.2.11"],
        ["negotiator", "0.2.8"],
        ["graceful-fs", "1.2.3"],
        ["st", "0.2.4"],
      ]),
    }],
  ])],
  ["async-cache", new Map([
    ["0.1.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-async-cache-0.1.5-b7cd396d295aa8c52829bbe30ec33b62426006da/node_modules/async-cache/"),
      packageDependencies: new Map([
        ["lru-cache", "2.3.1"],
        ["async-cache", "0.1.5"],
      ]),
    }],
  ])],
  ["lru-cache", new Map([
    ["2.3.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-lru-cache-2.3.1-b3adf6b3d856e954e2c390e6cef22081245a53d6/node_modules/lru-cache/"),
      packageDependencies: new Map([
        ["lru-cache", "2.3.1"],
      ]),
    }],
    ["4.1.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-lru-cache-4.1.5-8bbe50ea85bed59bc9e33dcab8235ee9bcf443cd/node_modules/lru-cache/"),
      packageDependencies: new Map([
        ["pseudomap", "1.0.2"],
        ["yallist", "2.1.2"],
        ["lru-cache", "4.1.5"],
      ]),
    }],
  ])],
  ["fd", new Map([
    ["0.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-fd-0.0.3-b3240de86dbf5a345baae7382a07d4713566ff0c/node_modules/fd/"),
      packageDependencies: new Map([
        ["fd", "0.0.3"],
      ]),
    }],
  ])],
  ["stream-buffers", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-stream-buffers-3.0.2-5249005a8d5c2d00b3a32e6e0a6ea209dc4f3521/node_modules/stream-buffers/"),
      packageDependencies: new Map([
        ["stream-buffers", "3.0.2"],
      ]),
    }],
  ])],
  ["tap", new Map([
    ["5.8.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-tap-5.8.0-cbd7164884cbc85566f9c937a2806b911f429adc/node_modules/tap/"),
      packageDependencies: new Map([
        ["bluebird", "3.5.5"],
        ["clean-yaml-object", "0.1.0"],
        ["codecov.io", "0.1.6"],
        ["coveralls", "2.13.3"],
        ["deeper", "2.1.0"],
        ["foreground-child", "1.5.6"],
        ["glob", "7.1.4"],
        ["isexe", "1.1.2"],
        ["js-yaml", "3.13.1"],
        ["nyc", "6.6.1"],
        ["only-shallow", "1.2.0"],
        ["opener", "1.5.1"],
        ["readable-stream", "2.3.6"],
        ["signal-exit", "2.1.2"],
        ["stack-utils", "0.4.0"],
        ["supports-color", "1.3.1"],
        ["tap-mocha-reporter", "0.0.27"],
        ["tap-parser", "1.3.2"],
        ["tmatch", "2.0.1"],
        ["tap", "5.8.0"],
      ]),
    }],
  ])],
  ["clean-yaml-object", new Map([
    ["0.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-clean-yaml-object-0.1.0-63fb110dc2ce1a84dc21f6d9334876d010ae8b68/node_modules/clean-yaml-object/"),
      packageDependencies: new Map([
        ["clean-yaml-object", "0.1.0"],
      ]),
    }],
  ])],
  ["codecov.io", new Map([
    ["0.1.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-codecov-io-0.1.6-59dfd02da1ff31c2fb2b952ad8ad16fd3781b728/node_modules/codecov.io/"),
      packageDependencies: new Map([
        ["request", "2.42.0"],
        ["urlgrey", "0.4.0"],
        ["codecov.io", "0.1.6"],
      ]),
    }],
  ])],
  ["request", new Map([
    ["2.42.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-request-2.42.0-572bd0148938564040ac7ab148b96423a063304a/node_modules/request/"),
      packageDependencies: new Map([
        ["bl", "0.9.5"],
        ["caseless", "0.6.0"],
        ["forever-agent", "0.5.2"],
        ["json-stringify-safe", "5.0.1"],
        ["mime-types", "1.0.2"],
        ["node-uuid", "1.4.8"],
        ["qs", "1.2.2"],
        ["tunnel-agent", "0.4.3"],
        ["aws-sign2", "0.5.0"],
        ["form-data", "0.1.4"],
        ["hawk", "1.1.1"],
        ["http-signature", "0.10.1"],
        ["oauth-sign", "0.4.0"],
        ["stringstream", "0.0.6"],
        ["tough-cookie", "3.0.1"],
        ["request", "2.42.0"],
      ]),
    }],
    ["2.79.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-request-2.79.0-4dfe5bf6be8b8cdc37fcf93e04b65577722710de/node_modules/request/"),
      packageDependencies: new Map([
        ["aws-sign2", "0.6.0"],
        ["aws4", "1.8.0"],
        ["caseless", "0.11.0"],
        ["combined-stream", "1.0.8"],
        ["extend", "3.0.2"],
        ["forever-agent", "0.6.1"],
        ["form-data", "2.1.4"],
        ["har-validator", "2.0.6"],
        ["hawk", "3.1.3"],
        ["http-signature", "1.1.1"],
        ["is-typedarray", "1.0.0"],
        ["isstream", "0.1.2"],
        ["json-stringify-safe", "5.0.1"],
        ["mime-types", "2.1.24"],
        ["oauth-sign", "0.8.2"],
        ["qs", "6.3.2"],
        ["stringstream", "0.0.6"],
        ["tough-cookie", "2.3.4"],
        ["tunnel-agent", "0.4.3"],
        ["uuid", "3.3.3"],
        ["request", "2.79.0"],
      ]),
    }],
  ])],
  ["bl", new Map([
    ["0.9.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-bl-0.9.5-c06b797af085ea00bc527afc8efcf11de2232054/node_modules/bl/"),
      packageDependencies: new Map([
        ["readable-stream", "1.0.34"],
        ["bl", "0.9.5"],
      ]),
    }],
  ])],
  ["caseless", new Map([
    ["0.6.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-caseless-0.6.0-8167c1ab8397fb5bb95f96d28e5a81c50f247ac4/node_modules/caseless/"),
      packageDependencies: new Map([
        ["caseless", "0.6.0"],
      ]),
    }],
    ["0.11.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-caseless-0.11.0-715b96ea9841593cc33067923f5ec60ebda4f7d7/node_modules/caseless/"),
      packageDependencies: new Map([
        ["caseless", "0.11.0"],
      ]),
    }],
  ])],
  ["forever-agent", new Map([
    ["0.5.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-forever-agent-0.5.2-6d0e09c4921f94a27f63d3b49c5feff1ea4c5130/node_modules/forever-agent/"),
      packageDependencies: new Map([
        ["forever-agent", "0.5.2"],
      ]),
    }],
    ["0.6.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-forever-agent-0.6.1-fbc71f0c41adeb37f96c577ad1ed42d8fdacca91/node_modules/forever-agent/"),
      packageDependencies: new Map([
        ["forever-agent", "0.6.1"],
      ]),
    }],
  ])],
  ["json-stringify-safe", new Map([
    ["5.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-json-stringify-safe-5.0.1-1296a2d58fd45f19a0f6ce01d65701e2c735b6eb/node_modules/json-stringify-safe/"),
      packageDependencies: new Map([
        ["json-stringify-safe", "5.0.1"],
      ]),
    }],
  ])],
  ["node-uuid", new Map([
    ["1.4.8", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-node-uuid-1.4.8-b040eb0923968afabf8d32fb1f17f1167fdab907/node_modules/node-uuid/"),
      packageDependencies: new Map([
        ["node-uuid", "1.4.8"],
      ]),
    }],
  ])],
  ["tunnel-agent", new Map([
    ["0.4.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-tunnel-agent-0.4.3-6373db76909fe570e08d73583365ed828a74eeeb/node_modules/tunnel-agent/"),
      packageDependencies: new Map([
        ["tunnel-agent", "0.4.3"],
      ]),
    }],
  ])],
  ["aws-sign2", new Map([
    ["0.5.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-aws-sign2-0.5.0-c57103f7a17fc037f02d7c2e64b602ea223f7d63/node_modules/aws-sign2/"),
      packageDependencies: new Map([
        ["aws-sign2", "0.5.0"],
      ]),
    }],
    ["0.6.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-aws-sign2-0.6.0-14342dd38dbcc94d0e5b87d763cd63612c0e794f/node_modules/aws-sign2/"),
      packageDependencies: new Map([
        ["aws-sign2", "0.6.0"],
      ]),
    }],
  ])],
  ["form-data", new Map([
    ["0.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-form-data-0.1.4-91abd788aba9702b1aabfa8bc01031a2ac9e3b12/node_modules/form-data/"),
      packageDependencies: new Map([
        ["async", "0.9.2"],
        ["combined-stream", "0.0.7"],
        ["mime", "1.2.11"],
        ["form-data", "0.1.4"],
      ]),
    }],
    ["2.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-form-data-2.1.4-33c183acf193276ecaa98143a69e94bfee1750d1/node_modules/form-data/"),
      packageDependencies: new Map([
        ["asynckit", "0.4.0"],
        ["combined-stream", "1.0.8"],
        ["mime-types", "2.1.24"],
        ["form-data", "2.1.4"],
      ]),
    }],
  ])],
  ["combined-stream", new Map([
    ["0.0.7", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-combined-stream-0.0.7-0137e657baa5a7541c57ac37ac5fc07d73b4dc1f/node_modules/combined-stream/"),
      packageDependencies: new Map([
        ["delayed-stream", "0.0.5"],
        ["combined-stream", "0.0.7"],
      ]),
    }],
    ["1.0.8", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-combined-stream-1.0.8-c3d45a8b34fd730631a110a8a2520682b31d5a7f/node_modules/combined-stream/"),
      packageDependencies: new Map([
        ["delayed-stream", "1.0.0"],
        ["combined-stream", "1.0.8"],
      ]),
    }],
  ])],
  ["delayed-stream", new Map([
    ["0.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-delayed-stream-0.0.5-d4b1f43a93e8296dfe02694f4680bc37a313c73f/node_modules/delayed-stream/"),
      packageDependencies: new Map([
        ["delayed-stream", "0.0.5"],
      ]),
    }],
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-delayed-stream-1.0.0-df3ae199acadfb7d440aaae0b29e2272b24ec619/node_modules/delayed-stream/"),
      packageDependencies: new Map([
        ["delayed-stream", "1.0.0"],
      ]),
    }],
  ])],
  ["hawk", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-hawk-1.1.1-87cd491f9b46e4e2aeaca335416766885d2d1ed9/node_modules/hawk/"),
      packageDependencies: new Map([
        ["boom", "0.4.2"],
        ["cryptiles", "0.2.2"],
        ["hoek", "0.9.1"],
        ["sntp", "0.2.4"],
        ["hawk", "1.1.1"],
      ]),
    }],
    ["3.1.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-hawk-3.1.3-078444bd7c1640b0fe540d2c9b73d59678e8e1c4/node_modules/hawk/"),
      packageDependencies: new Map([
        ["boom", "2.10.1"],
        ["cryptiles", "2.0.5"],
        ["hoek", "2.16.3"],
        ["sntp", "1.0.9"],
        ["hawk", "3.1.3"],
      ]),
    }],
  ])],
  ["boom", new Map([
    ["0.4.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-boom-0.4.2-7a636e9ded4efcefb19cef4947a3c67dfaee911b/node_modules/boom/"),
      packageDependencies: new Map([
        ["hoek", "0.9.1"],
        ["boom", "0.4.2"],
      ]),
    }],
    ["2.10.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-boom-2.10.1-39c8918ceff5799f83f9492a848f625add0c766f/node_modules/boom/"),
      packageDependencies: new Map([
        ["hoek", "2.16.3"],
        ["boom", "2.10.1"],
      ]),
    }],
  ])],
  ["hoek", new Map([
    ["0.9.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-hoek-0.9.1-3d322462badf07716ea7eb85baf88079cddce505/node_modules/hoek/"),
      packageDependencies: new Map([
        ["hoek", "0.9.1"],
      ]),
    }],
    ["2.16.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-hoek-2.16.3-20bb7403d3cea398e91dc4710a8ff1b8274a25ed/node_modules/hoek/"),
      packageDependencies: new Map([
        ["hoek", "2.16.3"],
      ]),
    }],
  ])],
  ["cryptiles", new Map([
    ["0.2.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-cryptiles-0.2.2-ed91ff1f17ad13d3748288594f8a48a0d26f325c/node_modules/cryptiles/"),
      packageDependencies: new Map([
        ["boom", "0.4.2"],
        ["cryptiles", "0.2.2"],
      ]),
    }],
    ["2.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-cryptiles-2.0.5-3bdfecdc608147c1c67202fa291e7dca59eaa3b8/node_modules/cryptiles/"),
      packageDependencies: new Map([
        ["boom", "2.10.1"],
        ["cryptiles", "2.0.5"],
      ]),
    }],
  ])],
  ["sntp", new Map([
    ["0.2.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-sntp-0.2.4-fb885f18b0f3aad189f824862536bceeec750900/node_modules/sntp/"),
      packageDependencies: new Map([
        ["hoek", "0.9.1"],
        ["sntp", "0.2.4"],
      ]),
    }],
    ["1.0.9", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-sntp-1.0.9-6541184cc90aeea6c6e7b35e2659082443c66198/node_modules/sntp/"),
      packageDependencies: new Map([
        ["hoek", "2.16.3"],
        ["sntp", "1.0.9"],
      ]),
    }],
  ])],
  ["http-signature", new Map([
    ["0.10.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-http-signature-0.10.1-4fbdac132559aa8323121e540779c0a012b27e66/node_modules/http-signature/"),
      packageDependencies: new Map([
        ["asn1", "0.1.11"],
        ["assert-plus", "0.1.5"],
        ["ctype", "0.5.3"],
        ["http-signature", "0.10.1"],
      ]),
    }],
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-http-signature-1.1.1-df72e267066cd0ac67fb76adf8e134a8fbcf91bf/node_modules/http-signature/"),
      packageDependencies: new Map([
        ["assert-plus", "0.2.0"],
        ["jsprim", "1.4.1"],
        ["sshpk", "1.16.1"],
        ["http-signature", "1.1.1"],
      ]),
    }],
  ])],
  ["asn1", new Map([
    ["0.1.11", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-asn1-0.1.11-559be18376d08a4ec4dbe80877d27818639b2df7/node_modules/asn1/"),
      packageDependencies: new Map([
        ["asn1", "0.1.11"],
      ]),
    }],
    ["0.2.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-asn1-0.2.4-8d2475dfab553bb33e77b54e59e880bb8ce23136/node_modules/asn1/"),
      packageDependencies: new Map([
        ["safer-buffer", "2.1.2"],
        ["asn1", "0.2.4"],
      ]),
    }],
  ])],
  ["assert-plus", new Map([
    ["0.1.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-assert-plus-0.1.5-ee74009413002d84cec7219c6ac811812e723160/node_modules/assert-plus/"),
      packageDependencies: new Map([
        ["assert-plus", "0.1.5"],
      ]),
    }],
    ["0.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-assert-plus-0.2.0-d74e1b87e7affc0db8aadb7021f3fe48101ab234/node_modules/assert-plus/"),
      packageDependencies: new Map([
        ["assert-plus", "0.2.0"],
      ]),
    }],
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-assert-plus-1.0.0-f12e0f3c5d77b0b1cdd9146942e4e96c1e4dd525/node_modules/assert-plus/"),
      packageDependencies: new Map([
        ["assert-plus", "1.0.0"],
      ]),
    }],
  ])],
  ["ctype", new Map([
    ["0.5.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ctype-0.5.3-82c18c2461f74114ef16c135224ad0b9144ca12f/node_modules/ctype/"),
      packageDependencies: new Map([
        ["ctype", "0.5.3"],
      ]),
    }],
  ])],
  ["oauth-sign", new Map([
    ["0.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-oauth-sign-0.4.0-f22956f31ea7151a821e5f2fb32c113cad8b9f69/node_modules/oauth-sign/"),
      packageDependencies: new Map([
        ["oauth-sign", "0.4.0"],
      ]),
    }],
    ["0.8.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-oauth-sign-0.8.2-46a6ab7f0aead8deae9ec0565780b7d4efeb9d43/node_modules/oauth-sign/"),
      packageDependencies: new Map([
        ["oauth-sign", "0.8.2"],
      ]),
    }],
  ])],
  ["stringstream", new Map([
    ["0.0.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-stringstream-0.0.6-7880225b0d4ad10e30927d167a1d6f2fd3b33a72/node_modules/stringstream/"),
      packageDependencies: new Map([
        ["stringstream", "0.0.6"],
      ]),
    }],
  ])],
  ["tough-cookie", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-tough-cookie-3.0.1-9df4f57e739c26930a018184887f4adb7dca73b2/node_modules/tough-cookie/"),
      packageDependencies: new Map([
        ["ip-regex", "2.1.0"],
        ["psl", "1.4.0"],
        ["punycode", "2.1.1"],
        ["tough-cookie", "3.0.1"],
      ]),
    }],
    ["2.3.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-tough-cookie-2.3.4-ec60cee38ac675063ffc97a5c18970578ee83655/node_modules/tough-cookie/"),
      packageDependencies: new Map([
        ["punycode", "1.4.1"],
        ["tough-cookie", "2.3.4"],
      ]),
    }],
  ])],
  ["ip-regex", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ip-regex-2.1.0-fa78bf5d2e6913c911ce9f819ee5146bb6d844e9/node_modules/ip-regex/"),
      packageDependencies: new Map([
        ["ip-regex", "2.1.0"],
      ]),
    }],
  ])],
  ["psl", new Map([
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-psl-1.4.0-5dd26156cdb69fa1fdb8ab1991667d3f80ced7c2/node_modules/psl/"),
      packageDependencies: new Map([
        ["psl", "1.4.0"],
      ]),
    }],
  ])],
  ["punycode", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-punycode-2.1.1-b58b010ac40c22c5657616c8d2c2c02c7bf479ec/node_modules/punycode/"),
      packageDependencies: new Map([
        ["punycode", "2.1.1"],
      ]),
    }],
    ["1.4.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-punycode-1.4.1-c0d5a63b2718800ad8e1eb0fa5269c84dd41845e/node_modules/punycode/"),
      packageDependencies: new Map([
        ["punycode", "1.4.1"],
      ]),
    }],
    ["1.3.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-punycode-1.3.2-9653a036fb7c1ee42342f2325cceefea3926c48d/node_modules/punycode/"),
      packageDependencies: new Map([
        ["punycode", "1.3.2"],
      ]),
    }],
  ])],
  ["urlgrey", new Map([
    ["0.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-urlgrey-0.4.0-f065357040fb35c3b311d4e5dc36484d96dbea06/node_modules/urlgrey/"),
      packageDependencies: new Map([
        ["tape", "2.3.0"],
        ["urlgrey", "0.4.0"],
      ]),
    }],
  ])],
  ["tape", new Map([
    ["2.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-tape-2.3.0-0dfeec709227fbcc9170abe7f046962b271431db/node_modules/tape/"),
      packageDependencies: new Map([
        ["deep-equal", "0.1.2"],
        ["defined", "0.0.0"],
        ["inherits", "2.0.4"],
        ["jsonify", "0.0.0"],
        ["resumer", "0.0.0"],
        ["split", "0.2.10"],
        ["stream-combiner", "0.0.4"],
        ["through", "2.3.8"],
        ["tape", "2.3.0"],
      ]),
    }],
  ])],
  ["deep-equal", new Map([
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-deep-equal-0.1.2-b246c2b80a570a47c11be1d9bd1070ec878b87ce/node_modules/deep-equal/"),
      packageDependencies: new Map([
        ["deep-equal", "0.1.2"],
      ]),
    }],
  ])],
  ["defined", new Map([
    ["0.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-defined-0.0.0-f35eea7d705e933baf13b2f03b3f83d921403b3e/node_modules/defined/"),
      packageDependencies: new Map([
        ["defined", "0.0.0"],
      ]),
    }],
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-defined-1.0.0-c98d9bcef75674188e110969151199e39b1fa693/node_modules/defined/"),
      packageDependencies: new Map([
        ["defined", "1.0.0"],
      ]),
    }],
  ])],
  ["jsonify", new Map([
    ["0.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-jsonify-0.0.0-2c74b6ee41d93ca51b7b5aaee8f503631d252a73/node_modules/jsonify/"),
      packageDependencies: new Map([
        ["jsonify", "0.0.0"],
      ]),
    }],
  ])],
  ["resumer", new Map([
    ["0.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-resumer-0.0.0-f1e8f461e4064ba39e82af3cdc2a8c893d076759/node_modules/resumer/"),
      packageDependencies: new Map([
        ["through", "2.3.8"],
        ["resumer", "0.0.0"],
      ]),
    }],
  ])],
  ["through", new Map([
    ["2.3.8", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-through-2.3.8-0dd4c9ffaabc357960b1b724115d7e0e86a2e1f5/node_modules/through/"),
      packageDependencies: new Map([
        ["through", "2.3.8"],
      ]),
    }],
  ])],
  ["split", new Map([
    ["0.2.10", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-split-0.2.10-67097c601d697ce1368f418f06cd201cf0521a57/node_modules/split/"),
      packageDependencies: new Map([
        ["through", "2.3.8"],
        ["split", "0.2.10"],
      ]),
    }],
  ])],
  ["stream-combiner", new Map([
    ["0.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-stream-combiner-0.0.4-4d5e433c185261dde623ca3f44c586bcf5c4ad14/node_modules/stream-combiner/"),
      packageDependencies: new Map([
        ["duplexer", "0.1.1"],
        ["stream-combiner", "0.0.4"],
      ]),
    }],
  ])],
  ["duplexer", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-duplexer-0.1.1-ace6ff808c1ce66b57d1ebf97977acb02334cfc1/node_modules/duplexer/"),
      packageDependencies: new Map([
        ["duplexer", "0.1.1"],
      ]),
    }],
  ])],
  ["coveralls", new Map([
    ["2.13.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-coveralls-2.13.3-9ad7c2ae527417f361e8b626483f48ee92dd2bc7/node_modules/coveralls/"),
      packageDependencies: new Map([
        ["js-yaml", "3.6.1"],
        ["lcov-parse", "0.0.10"],
        ["log-driver", "1.2.5"],
        ["minimist", "1.2.0"],
        ["request", "2.79.0"],
        ["coveralls", "2.13.3"],
      ]),
    }],
  ])],
  ["js-yaml", new Map([
    ["3.6.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-js-yaml-3.6.1-6e5fe67d8b205ce4d22fad05b7781e8dadcc4b30/node_modules/js-yaml/"),
      packageDependencies: new Map([
        ["argparse", "1.0.10"],
        ["esprima", "2.7.3"],
        ["js-yaml", "3.6.1"],
      ]),
    }],
    ["3.13.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-js-yaml-3.13.1-aff151b30bfdfa8e49e05da22e7415e9dfa37847/node_modules/js-yaml/"),
      packageDependencies: new Map([
        ["argparse", "1.0.10"],
        ["esprima", "4.0.1"],
        ["js-yaml", "3.13.1"],
      ]),
    }],
  ])],
  ["argparse", new Map([
    ["1.0.10", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-argparse-1.0.10-bcd6791ea5ae09725e17e5ad988134cd40b3d911/node_modules/argparse/"),
      packageDependencies: new Map([
        ["sprintf-js", "1.0.3"],
        ["argparse", "1.0.10"],
      ]),
    }],
  ])],
  ["sprintf-js", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-sprintf-js-1.0.3-04e6926f662895354f3dd015203633b857297e2c/node_modules/sprintf-js/"),
      packageDependencies: new Map([
        ["sprintf-js", "1.0.3"],
      ]),
    }],
  ])],
  ["esprima", new Map([
    ["2.7.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-esprima-2.7.3-96e3b70d5779f6ad49cd032673d1c312767ba581/node_modules/esprima/"),
      packageDependencies: new Map([
        ["esprima", "2.7.3"],
      ]),
    }],
    ["4.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-esprima-4.0.1-13b04cdb3e6c5d19df91ab6987a8695619b0aa71/node_modules/esprima/"),
      packageDependencies: new Map([
        ["esprima", "4.0.1"],
      ]),
    }],
  ])],
  ["lcov-parse", new Map([
    ["0.0.10", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-lcov-parse-0.0.10-1b0b8ff9ac9c7889250582b70b71315d9da6d9a3/node_modules/lcov-parse/"),
      packageDependencies: new Map([
        ["lcov-parse", "0.0.10"],
      ]),
    }],
  ])],
  ["log-driver", new Map([
    ["1.2.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-log-driver-1.2.5-7ae4ec257302fd790d557cb10c97100d857b0056/node_modules/log-driver/"),
      packageDependencies: new Map([
        ["log-driver", "1.2.5"],
      ]),
    }],
  ])],
  ["minimist", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-minimist-1.2.0-a35008b20f41383eec1fb914f4cd5df79a264284/node_modules/minimist/"),
      packageDependencies: new Map([
        ["minimist", "1.2.0"],
      ]),
    }],
    ["0.0.8", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-minimist-0.0.8-857fcabfc3397d2625b8228262e86aa7a011b05d/node_modules/minimist/"),
      packageDependencies: new Map([
        ["minimist", "0.0.8"],
      ]),
    }],
    ["0.0.10", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-minimist-0.0.10-de3f98543dbf96082be48ad1a0c7cda836301dcf/node_modules/minimist/"),
      packageDependencies: new Map([
        ["minimist", "0.0.10"],
      ]),
    }],
  ])],
  ["aws4", new Map([
    ["1.8.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-aws4-1.8.0-f0e003d9ca9e7f59c7a508945d7b2ef9a04a542f/node_modules/aws4/"),
      packageDependencies: new Map([
        ["aws4", "1.8.0"],
      ]),
    }],
  ])],
  ["extend", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-extend-3.0.2-f8b1136b4071fbd8eb140aff858b1019ec2915fa/node_modules/extend/"),
      packageDependencies: new Map([
        ["extend", "3.0.2"],
      ]),
    }],
  ])],
  ["asynckit", new Map([
    ["0.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-asynckit-0.4.0-c79ed97f7f34cb8f2ba1bc9790bcc366474b4b79/node_modules/asynckit/"),
      packageDependencies: new Map([
        ["asynckit", "0.4.0"],
      ]),
    }],
  ])],
  ["har-validator", new Map([
    ["2.0.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-har-validator-2.0.6-cdcbc08188265ad119b6a5a7c8ab70eecfb5d27d/node_modules/har-validator/"),
      packageDependencies: new Map([
        ["chalk", "1.1.3"],
        ["commander", "2.20.0"],
        ["is-my-json-valid", "2.20.0"],
        ["pinkie-promise", "2.0.1"],
        ["har-validator", "2.0.6"],
      ]),
    }],
  ])],
  ["chalk", new Map([
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-chalk-1.1.3-a8115c55e4a702fe4d150abd3872822a7e09fc98/node_modules/chalk/"),
      packageDependencies: new Map([
        ["ansi-styles", "2.2.1"],
        ["escape-string-regexp", "1.0.5"],
        ["has-ansi", "2.0.0"],
        ["strip-ansi", "3.0.1"],
        ["supports-color", "2.0.0"],
        ["chalk", "1.1.3"],
      ]),
    }],
  ])],
  ["ansi-styles", new Map([
    ["2.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ansi-styles-2.2.1-b432dd3358b634cf75e1e4664368240533c1ddbe/node_modules/ansi-styles/"),
      packageDependencies: new Map([
        ["ansi-styles", "2.2.1"],
      ]),
    }],
  ])],
  ["escape-string-regexp", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-escape-string-regexp-1.0.5-1b61c0562190a8dff6ae3bb2cf0200ca130b86d4/node_modules/escape-string-regexp/"),
      packageDependencies: new Map([
        ["escape-string-regexp", "1.0.5"],
      ]),
    }],
  ])],
  ["has-ansi", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-has-ansi-2.0.0-34f5049ce1ecdf2b0649af3ef24e45ed35416d91/node_modules/has-ansi/"),
      packageDependencies: new Map([
        ["ansi-regex", "2.1.1"],
        ["has-ansi", "2.0.0"],
      ]),
    }],
  ])],
  ["ansi-regex", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ansi-regex-2.1.1-c3b33ab5ee360d86e0e628f0468ae7ef27d654df/node_modules/ansi-regex/"),
      packageDependencies: new Map([
        ["ansi-regex", "2.1.1"],
      ]),
    }],
  ])],
  ["strip-ansi", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-strip-ansi-3.0.1-6a385fb8853d952d5ff05d0e8aaf94278dc63dcf/node_modules/strip-ansi/"),
      packageDependencies: new Map([
        ["ansi-regex", "2.1.1"],
        ["strip-ansi", "3.0.1"],
      ]),
    }],
  ])],
  ["supports-color", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-supports-color-2.0.0-535d045ce6b6363fa40117084629995e9df324c7/node_modules/supports-color/"),
      packageDependencies: new Map([
        ["supports-color", "2.0.0"],
      ]),
    }],
    ["3.2.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-supports-color-3.2.3-65ac0504b3954171d8a64946b2ae3cbb8a5f54f6/node_modules/supports-color/"),
      packageDependencies: new Map([
        ["has-flag", "1.0.0"],
        ["supports-color", "3.2.3"],
      ]),
    }],
    ["1.3.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-supports-color-1.3.1-15758df09d8ff3b4acc307539fabe27095e1042d/node_modules/supports-color/"),
      packageDependencies: new Map([
        ["supports-color", "1.3.1"],
      ]),
    }],
  ])],
  ["commander", new Map([
    ["2.20.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-commander-2.20.0-d58bb2b5c1ee8f87b0d340027e9e94e222c5a422/node_modules/commander/"),
      packageDependencies: new Map([
        ["commander", "2.20.0"],
      ]),
    }],
  ])],
  ["is-my-json-valid", new Map([
    ["2.20.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-my-json-valid-2.20.0-1345a6fca3e8daefc10d0fa77067f54cedafd59a/node_modules/is-my-json-valid/"),
      packageDependencies: new Map([
        ["generate-function", "2.3.1"],
        ["generate-object-property", "1.2.0"],
        ["is-my-ip-valid", "1.0.0"],
        ["jsonpointer", "4.0.1"],
        ["xtend", "4.0.2"],
        ["is-my-json-valid", "2.20.0"],
      ]),
    }],
  ])],
  ["generate-function", new Map([
    ["2.3.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-generate-function-2.3.1-f069617690c10c868e73b8465746764f97c3479f/node_modules/generate-function/"),
      packageDependencies: new Map([
        ["is-property", "1.0.2"],
        ["generate-function", "2.3.1"],
      ]),
    }],
  ])],
  ["is-property", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-property-1.0.2-57fe1c4e48474edd65b09911f26b1cd4095dda84/node_modules/is-property/"),
      packageDependencies: new Map([
        ["is-property", "1.0.2"],
      ]),
    }],
  ])],
  ["generate-object-property", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-generate-object-property-1.2.0-9c0e1c40308ce804f4783618b937fa88f99d50d0/node_modules/generate-object-property/"),
      packageDependencies: new Map([
        ["is-property", "1.0.2"],
        ["generate-object-property", "1.2.0"],
      ]),
    }],
  ])],
  ["is-my-ip-valid", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-my-ip-valid-1.0.0-7b351b8e8edd4d3995d4d066680e664d94696824/node_modules/is-my-ip-valid/"),
      packageDependencies: new Map([
        ["is-my-ip-valid", "1.0.0"],
      ]),
    }],
  ])],
  ["jsonpointer", new Map([
    ["4.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-jsonpointer-4.0.1-4fd92cb34e0e9db3c89c8622ecf51f9b978c6cb9/node_modules/jsonpointer/"),
      packageDependencies: new Map([
        ["jsonpointer", "4.0.1"],
      ]),
    }],
  ])],
  ["xtend", new Map([
    ["4.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-xtend-4.0.2-bb72779f5fa465186b1f438f674fa347fdb5db54/node_modules/xtend/"),
      packageDependencies: new Map([
        ["xtend", "4.0.2"],
      ]),
    }],
  ])],
  ["pinkie-promise", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-pinkie-promise-2.0.1-2135d6dfa7a358c069ac9b178776288228450ffa/node_modules/pinkie-promise/"),
      packageDependencies: new Map([
        ["pinkie", "2.0.4"],
        ["pinkie-promise", "2.0.1"],
      ]),
    }],
  ])],
  ["pinkie", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-pinkie-2.0.4-72556b80cfa0d48a974e80e77248e80ed4f7f870/node_modules/pinkie/"),
      packageDependencies: new Map([
        ["pinkie", "2.0.4"],
      ]),
    }],
  ])],
  ["jsprim", new Map([
    ["1.4.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-jsprim-1.4.1-313e66bc1e5cc06e438bc1b7499c2e5c56acb6a2/node_modules/jsprim/"),
      packageDependencies: new Map([
        ["assert-plus", "1.0.0"],
        ["extsprintf", "1.3.0"],
        ["json-schema", "0.2.3"],
        ["verror", "1.10.0"],
        ["jsprim", "1.4.1"],
      ]),
    }],
  ])],
  ["extsprintf", new Map([
    ["1.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-extsprintf-1.3.0-96918440e3041a7a414f8c52e3c574eb3c3e1e05/node_modules/extsprintf/"),
      packageDependencies: new Map([
        ["extsprintf", "1.3.0"],
      ]),
    }],
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-extsprintf-1.4.0-e2689f8f356fad62cca65a3a91c5df5f9551692f/node_modules/extsprintf/"),
      packageDependencies: new Map([
        ["extsprintf", "1.4.0"],
      ]),
    }],
  ])],
  ["json-schema", new Map([
    ["0.2.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-json-schema-0.2.3-b480c892e59a2f05954ce727bd3f2a4e882f9e13/node_modules/json-schema/"),
      packageDependencies: new Map([
        ["json-schema", "0.2.3"],
      ]),
    }],
  ])],
  ["verror", new Map([
    ["1.10.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-verror-1.10.0-3a105ca17053af55d6e270c1f8288682e18da400/node_modules/verror/"),
      packageDependencies: new Map([
        ["assert-plus", "1.0.0"],
        ["core-util-is", "1.0.2"],
        ["extsprintf", "1.4.0"],
        ["verror", "1.10.0"],
      ]),
    }],
  ])],
  ["sshpk", new Map([
    ["1.16.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-sshpk-1.16.1-fb661c0bef29b39db40769ee39fa70093d6f6877/node_modules/sshpk/"),
      packageDependencies: new Map([
        ["asn1", "0.2.4"],
        ["assert-plus", "1.0.0"],
        ["bcrypt-pbkdf", "1.0.2"],
        ["dashdash", "1.14.1"],
        ["ecc-jsbn", "0.1.2"],
        ["getpass", "0.1.7"],
        ["jsbn", "0.1.1"],
        ["safer-buffer", "2.1.2"],
        ["tweetnacl", "0.14.5"],
        ["sshpk", "1.16.1"],
      ]),
    }],
  ])],
  ["safer-buffer", new Map([
    ["2.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-safer-buffer-2.1.2-44fa161b0187b9549dd84bb91802f9bd8385cd6a/node_modules/safer-buffer/"),
      packageDependencies: new Map([
        ["safer-buffer", "2.1.2"],
      ]),
    }],
  ])],
  ["bcrypt-pbkdf", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-bcrypt-pbkdf-1.0.2-a4301d389b6a43f9b67ff3ca11a3f6637e360e9e/node_modules/bcrypt-pbkdf/"),
      packageDependencies: new Map([
        ["tweetnacl", "0.14.5"],
        ["bcrypt-pbkdf", "1.0.2"],
      ]),
    }],
  ])],
  ["tweetnacl", new Map([
    ["0.14.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-tweetnacl-0.14.5-5ae68177f192d4456269d108afa93ff8743f4f64/node_modules/tweetnacl/"),
      packageDependencies: new Map([
        ["tweetnacl", "0.14.5"],
      ]),
    }],
  ])],
  ["dashdash", new Map([
    ["1.14.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-dashdash-1.14.1-853cfa0f7cbe2fed5de20326b8dd581035f6e2f0/node_modules/dashdash/"),
      packageDependencies: new Map([
        ["assert-plus", "1.0.0"],
        ["dashdash", "1.14.1"],
      ]),
    }],
  ])],
  ["ecc-jsbn", new Map([
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ecc-jsbn-0.1.2-3a83a904e54353287874c564b7549386849a98c9/node_modules/ecc-jsbn/"),
      packageDependencies: new Map([
        ["jsbn", "0.1.1"],
        ["safer-buffer", "2.1.2"],
        ["ecc-jsbn", "0.1.2"],
      ]),
    }],
  ])],
  ["jsbn", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-jsbn-0.1.1-a5e654c2e5a2deb5f201d96cefbca80c0ef2f513/node_modules/jsbn/"),
      packageDependencies: new Map([
        ["jsbn", "0.1.1"],
      ]),
    }],
  ])],
  ["getpass", new Map([
    ["0.1.7", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-getpass-0.1.7-5eff8e3e684d569ae4cb2b1282604e8ba62149fa/node_modules/getpass/"),
      packageDependencies: new Map([
        ["assert-plus", "1.0.0"],
        ["getpass", "0.1.7"],
      ]),
    }],
  ])],
  ["is-typedarray", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-typedarray-1.0.0-e479c80858df0c1b11ddda6940f96011fcda4a9a/node_modules/is-typedarray/"),
      packageDependencies: new Map([
        ["is-typedarray", "1.0.0"],
      ]),
    }],
  ])],
  ["isstream", new Map([
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-isstream-0.1.2-47e63f7af55afa6f92e1500e690eb8b8529c099a/node_modules/isstream/"),
      packageDependencies: new Map([
        ["isstream", "0.1.2"],
      ]),
    }],
  ])],
  ["uuid", new Map([
    ["3.3.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-uuid-3.3.3-4568f0216e78760ee1dbf3a4d2cf53e224112866/node_modules/uuid/"),
      packageDependencies: new Map([
        ["uuid", "3.3.3"],
      ]),
    }],
  ])],
  ["deeper", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-deeper-2.1.0-bc564e5f73174fdf201e08b00030e8a14da74368/node_modules/deeper/"),
      packageDependencies: new Map([
        ["deeper", "2.1.0"],
      ]),
    }],
  ])],
  ["foreground-child", new Map([
    ["1.5.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-foreground-child-1.5.6-4fd71ad2dfde96789b980a5c0a295937cb2f5ce9/node_modules/foreground-child/"),
      packageDependencies: new Map([
        ["cross-spawn", "4.0.2"],
        ["signal-exit", "3.0.2"],
        ["foreground-child", "1.5.6"],
      ]),
    }],
  ])],
  ["cross-spawn", new Map([
    ["4.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-cross-spawn-4.0.2-7b9247621c23adfdd3856004a823cbe397424d41/node_modules/cross-spawn/"),
      packageDependencies: new Map([
        ["lru-cache", "4.1.5"],
        ["which", "1.3.1"],
        ["cross-spawn", "4.0.2"],
      ]),
    }],
  ])],
  ["pseudomap", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-pseudomap-1.0.2-f052a28da70e618917ef0a8ac34c1ae5a68286b3/node_modules/pseudomap/"),
      packageDependencies: new Map([
        ["pseudomap", "1.0.2"],
      ]),
    }],
  ])],
  ["yallist", new Map([
    ["2.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-yallist-2.1.2-1c11f9218f076089a47dd512f93c6699a6a81d52/node_modules/yallist/"),
      packageDependencies: new Map([
        ["yallist", "2.1.2"],
      ]),
    }],
  ])],
  ["which", new Map([
    ["1.3.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-which-1.3.1-a45043d54f5805316da8d62f9f50918d3da70b0a/node_modules/which/"),
      packageDependencies: new Map([
        ["isexe", "2.0.0"],
        ["which", "1.3.1"],
      ]),
    }],
  ])],
  ["isexe", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-isexe-2.0.0-e8fbf374dc556ff8947a10dcb0572d633f2cfa10/node_modules/isexe/"),
      packageDependencies: new Map([
        ["isexe", "2.0.0"],
      ]),
    }],
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-isexe-1.1.2-36f3e22e60750920f5e7241a476a8c6a42275ad0/node_modules/isexe/"),
      packageDependencies: new Map([
        ["isexe", "1.1.2"],
      ]),
    }],
  ])],
  ["signal-exit", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-signal-exit-3.0.2-b5fdc08f1287ea1178628e415e25132b73646c6d/node_modules/signal-exit/"),
      packageDependencies: new Map([
        ["signal-exit", "3.0.2"],
      ]),
    }],
    ["2.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-signal-exit-2.1.2-375879b1f92ebc3b334480d038dc546a6d558564/node_modules/signal-exit/"),
      packageDependencies: new Map([
        ["signal-exit", "2.1.2"],
      ]),
    }],
  ])],
  ["nyc", new Map([
    ["6.6.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-nyc-6.6.1-2f6014610a57070021c4c067e9b9e330a23ac6a7/node_modules/nyc/"),
      packageDependencies: new Map([
        ["append-transform", "0.4.0"],
        ["arrify", "1.0.1"],
        ["caching-transform", "1.0.1"],
        ["convert-source-map", "1.6.0"],
        ["default-require-extensions", "1.0.0"],
        ["find-cache-dir", "0.1.1"],
        ["find-up", "1.1.2"],
        ["foreground-child", "1.5.6"],
        ["glob", "7.1.4"],
        ["istanbul", "0.4.5"],
        ["md5-hex", "1.3.0"],
        ["micromatch", "2.3.11"],
        ["mkdirp", "0.5.1"],
        ["pkg-up", "1.0.0"],
        ["resolve-from", "2.0.0"],
        ["rimraf", "2.7.1"],
        ["signal-exit", "3.0.2"],
        ["source-map", "0.5.7"],
        ["spawn-wrap", "1.4.3"],
        ["test-exclude", "1.1.0"],
        ["yargs", "4.8.1"],
        ["nyc", "6.6.1"],
      ]),
    }],
  ])],
  ["append-transform", new Map([
    ["0.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-append-transform-0.4.0-d76ebf8ca94d276e247a36bad44a4b74ab611991/node_modules/append-transform/"),
      packageDependencies: new Map([
        ["default-require-extensions", "1.0.0"],
        ["append-transform", "0.4.0"],
      ]),
    }],
  ])],
  ["default-require-extensions", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-default-require-extensions-1.0.0-f37ea15d3e13ffd9b437d33e1a75b5fb97874cb8/node_modules/default-require-extensions/"),
      packageDependencies: new Map([
        ["strip-bom", "2.0.0"],
        ["default-require-extensions", "1.0.0"],
      ]),
    }],
  ])],
  ["strip-bom", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-strip-bom-2.0.0-6219a85616520491f35788bdbf1447a99c7e6b0e/node_modules/strip-bom/"),
      packageDependencies: new Map([
        ["is-utf8", "0.2.1"],
        ["strip-bom", "2.0.0"],
      ]),
    }],
  ])],
  ["is-utf8", new Map([
    ["0.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-utf8-0.2.1-4b0da1442104d1b336340e80797e865cf39f7d72/node_modules/is-utf8/"),
      packageDependencies: new Map([
        ["is-utf8", "0.2.1"],
      ]),
    }],
  ])],
  ["arrify", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-arrify-1.0.1-898508da2226f380df904728456849c1501a4b0d/node_modules/arrify/"),
      packageDependencies: new Map([
        ["arrify", "1.0.1"],
      ]),
    }],
  ])],
  ["caching-transform", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-caching-transform-1.0.1-6dbdb2f20f8d8fbce79f3e94e9d1742dcdf5c0a1/node_modules/caching-transform/"),
      packageDependencies: new Map([
        ["md5-hex", "1.3.0"],
        ["mkdirp", "0.5.1"],
        ["write-file-atomic", "1.3.4"],
        ["caching-transform", "1.0.1"],
      ]),
    }],
  ])],
  ["md5-hex", new Map([
    ["1.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-md5-hex-1.3.0-d2c4afe983c4370662179b8cad145219135046c4/node_modules/md5-hex/"),
      packageDependencies: new Map([
        ["md5-o-matic", "0.1.1"],
        ["md5-hex", "1.3.0"],
      ]),
    }],
  ])],
  ["md5-o-matic", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-md5-o-matic-0.1.1-822bccd65e117c514fab176b25945d54100a03c3/node_modules/md5-o-matic/"),
      packageDependencies: new Map([
        ["md5-o-matic", "0.1.1"],
      ]),
    }],
  ])],
  ["write-file-atomic", new Map([
    ["1.3.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-write-file-atomic-1.3.4-f807a4f0b1d9e913ae7a48112e6cc3af1991b45f/node_modules/write-file-atomic/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.2"],
        ["imurmurhash", "0.1.4"],
        ["slide", "1.1.6"],
        ["write-file-atomic", "1.3.4"],
      ]),
    }],
  ])],
  ["imurmurhash", new Map([
    ["0.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-imurmurhash-0.1.4-9218b9b2b928a238b13dc4fb6b6d576f231453ea/node_modules/imurmurhash/"),
      packageDependencies: new Map([
        ["imurmurhash", "0.1.4"],
      ]),
    }],
  ])],
  ["slide", new Map([
    ["1.1.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-slide-1.1.6-56eb027d65b4d2dce6cb2e2d32c4d4afc9e1d707/node_modules/slide/"),
      packageDependencies: new Map([
        ["slide", "1.1.6"],
      ]),
    }],
  ])],
  ["convert-source-map", new Map([
    ["1.6.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-convert-source-map-1.6.0-51b537a8c43e0f04dec1993bffcdd504e758ac20/node_modules/convert-source-map/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.1.2"],
        ["convert-source-map", "1.6.0"],
      ]),
    }],
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-convert-source-map-1.1.3-4829c877e9fe49b3161f3bf3673888e204699860/node_modules/convert-source-map/"),
      packageDependencies: new Map([
        ["convert-source-map", "1.1.3"],
      ]),
    }],
  ])],
  ["find-cache-dir", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-find-cache-dir-0.1.1-c8defae57c8a52a8a784f9e31c57c742e993a0b9/node_modules/find-cache-dir/"),
      packageDependencies: new Map([
        ["commondir", "1.0.1"],
        ["mkdirp", "0.5.1"],
        ["pkg-dir", "1.0.0"],
        ["find-cache-dir", "0.1.1"],
      ]),
    }],
  ])],
  ["commondir", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-commondir-1.0.1-ddd800da0c66127393cca5950ea968a3aaf1253b/node_modules/commondir/"),
      packageDependencies: new Map([
        ["commondir", "1.0.1"],
      ]),
    }],
  ])],
  ["pkg-dir", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-pkg-dir-1.0.0-7a4b508a8d5bb2d629d447056ff4e9c9314cf3d4/node_modules/pkg-dir/"),
      packageDependencies: new Map([
        ["find-up", "1.1.2"],
        ["pkg-dir", "1.0.0"],
      ]),
    }],
  ])],
  ["find-up", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-find-up-1.1.2-6b2e9822b1a2ce0a60ab64d610eccad53cb24d0f/node_modules/find-up/"),
      packageDependencies: new Map([
        ["path-exists", "2.1.0"],
        ["pinkie-promise", "2.0.1"],
        ["find-up", "1.1.2"],
      ]),
    }],
  ])],
  ["path-exists", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-path-exists-2.1.0-0feb6c64f0fc518d9a754dd5efb62c7022761f4b/node_modules/path-exists/"),
      packageDependencies: new Map([
        ["pinkie-promise", "2.0.1"],
        ["path-exists", "2.1.0"],
      ]),
    }],
  ])],
  ["istanbul", new Map([
    ["0.4.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-istanbul-0.4.5-65c7d73d4c4da84d4f3ac310b918fb0b8033733b/node_modules/istanbul/"),
      packageDependencies: new Map([
        ["abbrev", "1.0.9"],
        ["async", "1.5.2"],
        ["escodegen", "1.8.1"],
        ["esprima", "2.7.3"],
        ["glob", "5.0.15"],
        ["handlebars", "4.3.0"],
        ["js-yaml", "3.13.1"],
        ["mkdirp", "0.5.1"],
        ["nopt", "3.0.6"],
        ["once", "1.4.0"],
        ["resolve", "1.1.7"],
        ["supports-color", "3.2.3"],
        ["which", "1.3.1"],
        ["wordwrap", "1.0.0"],
        ["istanbul", "0.4.5"],
      ]),
    }],
  ])],
  ["escodegen", new Map([
    ["1.8.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-escodegen-1.8.1-5a5b53af4693110bebb0867aa3430dd3b70a1018/node_modules/escodegen/"),
      packageDependencies: new Map([
        ["esprima", "2.7.3"],
        ["estraverse", "1.9.3"],
        ["esutils", "2.0.3"],
        ["optionator", "0.8.2"],
        ["source-map", "0.2.0"],
        ["escodegen", "1.8.1"],
      ]),
    }],
  ])],
  ["estraverse", new Map([
    ["1.9.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-estraverse-1.9.3-af67f2dc922582415950926091a4005d29c9bb44/node_modules/estraverse/"),
      packageDependencies: new Map([
        ["estraverse", "1.9.3"],
      ]),
    }],
  ])],
  ["esutils", new Map([
    ["2.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-esutils-2.0.3-74d2eb4de0b8da1293711910d50775b9b710ef64/node_modules/esutils/"),
      packageDependencies: new Map([
        ["esutils", "2.0.3"],
      ]),
    }],
  ])],
  ["optionator", new Map([
    ["0.8.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-optionator-0.8.2-364c5e409d3f4d6301d6c0b4c05bba50180aeb64/node_modules/optionator/"),
      packageDependencies: new Map([
        ["deep-is", "0.1.3"],
        ["fast-levenshtein", "2.0.6"],
        ["levn", "0.3.0"],
        ["prelude-ls", "1.1.2"],
        ["type-check", "0.3.2"],
        ["wordwrap", "1.0.0"],
        ["optionator", "0.8.2"],
      ]),
    }],
  ])],
  ["deep-is", new Map([
    ["0.1.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-deep-is-0.1.3-b369d6fb5dbc13eecf524f91b070feedc357cf34/node_modules/deep-is/"),
      packageDependencies: new Map([
        ["deep-is", "0.1.3"],
      ]),
    }],
  ])],
  ["fast-levenshtein", new Map([
    ["2.0.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-fast-levenshtein-2.0.6-3d8a5c66883a16a30ca8643e851f19baa7797917/node_modules/fast-levenshtein/"),
      packageDependencies: new Map([
        ["fast-levenshtein", "2.0.6"],
      ]),
    }],
  ])],
  ["levn", new Map([
    ["0.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-levn-0.3.0-3b09924edf9f083c0490fdd4c0bc4421e04764ee/node_modules/levn/"),
      packageDependencies: new Map([
        ["prelude-ls", "1.1.2"],
        ["type-check", "0.3.2"],
        ["levn", "0.3.0"],
      ]),
    }],
  ])],
  ["prelude-ls", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-prelude-ls-1.1.2-21932a549f5e52ffd9a827f570e04be62a97da54/node_modules/prelude-ls/"),
      packageDependencies: new Map([
        ["prelude-ls", "1.1.2"],
      ]),
    }],
  ])],
  ["type-check", new Map([
    ["0.3.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-type-check-0.3.2-5884cab512cf1d355e3fb784f30804b2b520db72/node_modules/type-check/"),
      packageDependencies: new Map([
        ["prelude-ls", "1.1.2"],
        ["type-check", "0.3.2"],
      ]),
    }],
  ])],
  ["wordwrap", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-wordwrap-1.0.0-27584810891456a4171c8d0226441ade90cbcaeb/node_modules/wordwrap/"),
      packageDependencies: new Map([
        ["wordwrap", "1.0.0"],
      ]),
    }],
    ["0.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-wordwrap-0.0.3-a3d5da6cd5c0bc0008d37234bbaf1bed63059107/node_modules/wordwrap/"),
      packageDependencies: new Map([
        ["wordwrap", "0.0.3"],
      ]),
    }],
  ])],
  ["source-map", new Map([
    ["0.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-source-map-0.2.0-dab73fbcfc2ba819b4de03bd6f6eaa48164b3f9d/node_modules/source-map/"),
      packageDependencies: new Map([
        ["amdefine", "1.0.1"],
        ["source-map", "0.2.0"],
      ]),
    }],
    ["0.6.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-source-map-0.6.1-74722af32e9614e9c287a8d0bbde48b5e2f1a263/node_modules/source-map/"),
      packageDependencies: new Map([
        ["source-map", "0.6.1"],
      ]),
    }],
    ["0.5.7", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-source-map-0.5.7-8a039d2d1021d22d1ea14c80d8ea468ba2ef3fcc/node_modules/source-map/"),
      packageDependencies: new Map([
        ["source-map", "0.5.7"],
      ]),
    }],
  ])],
  ["amdefine", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-amdefine-1.0.1-4a5282ac164729e93619bcfd3ad151f817ce91f5/node_modules/amdefine/"),
      packageDependencies: new Map([
        ["amdefine", "1.0.1"],
      ]),
    }],
  ])],
  ["handlebars", new Map([
    ["4.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-handlebars-4.3.0-427391b584626c9c9c6ffb7d1fb90aa9789221cc/node_modules/handlebars/"),
      packageDependencies: new Map([
        ["neo-async", "2.6.1"],
        ["optimist", "0.6.1"],
        ["source-map", "0.6.1"],
        ["uglify-js", "3.6.0"],
        ["handlebars", "4.3.0"],
      ]),
    }],
  ])],
  ["neo-async", new Map([
    ["2.6.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-neo-async-2.6.1-ac27ada66167fa8849a6addd837f6b189ad2081c/node_modules/neo-async/"),
      packageDependencies: new Map([
        ["neo-async", "2.6.1"],
      ]),
    }],
  ])],
  ["optimist", new Map([
    ["0.6.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-optimist-0.6.1-da3ea74686fa21a19a111c326e90eb15a0196686/node_modules/optimist/"),
      packageDependencies: new Map([
        ["minimist", "0.0.10"],
        ["wordwrap", "0.0.3"],
        ["optimist", "0.6.1"],
      ]),
    }],
  ])],
  ["uglify-js", new Map([
    ["3.6.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-uglify-js-3.6.0-704681345c53a8b2079fb6cec294b05ead242ff5/node_modules/uglify-js/"),
      packageDependencies: new Map([
        ["commander", "2.20.0"],
        ["source-map", "0.6.1"],
        ["uglify-js", "3.6.0"],
      ]),
    }],
  ])],
  ["resolve", new Map([
    ["1.1.7", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-resolve-1.1.7-203114d82ad2c5ed9e8e0411b3932875e889e97b/node_modules/resolve/"),
      packageDependencies: new Map([
        ["resolve", "1.1.7"],
      ]),
    }],
    ["1.12.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-resolve-1.12.0-3fc644a35c84a48554609ff26ec52b66fa577df6/node_modules/resolve/"),
      packageDependencies: new Map([
        ["path-parse", "1.0.6"],
        ["resolve", "1.12.0"],
      ]),
    }],
  ])],
  ["has-flag", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-has-flag-1.0.0-9d9e793165ce017a00f00418c43f942a7b1d11fa/node_modules/has-flag/"),
      packageDependencies: new Map([
        ["has-flag", "1.0.0"],
      ]),
    }],
  ])],
  ["micromatch", new Map([
    ["2.3.11", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-micromatch-2.3.11-86677c97d1720b363431d04d0d15293bd38c1565/node_modules/micromatch/"),
      packageDependencies: new Map([
        ["arr-diff", "2.0.0"],
        ["array-unique", "0.2.1"],
        ["braces", "1.8.5"],
        ["expand-brackets", "0.1.5"],
        ["extglob", "0.3.2"],
        ["filename-regex", "2.0.1"],
        ["is-extglob", "1.0.0"],
        ["is-glob", "2.0.1"],
        ["kind-of", "3.2.2"],
        ["normalize-path", "2.1.1"],
        ["object.omit", "2.0.1"],
        ["parse-glob", "3.0.4"],
        ["regex-cache", "0.4.4"],
        ["micromatch", "2.3.11"],
      ]),
    }],
  ])],
  ["arr-diff", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-arr-diff-2.0.0-8f3b827f955a8bd669697e4a4256ac3ceae356cf/node_modules/arr-diff/"),
      packageDependencies: new Map([
        ["arr-flatten", "1.1.0"],
        ["arr-diff", "2.0.0"],
      ]),
    }],
  ])],
  ["arr-flatten", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-arr-flatten-1.1.0-36048bbff4e7b47e136644316c99669ea5ae91f1/node_modules/arr-flatten/"),
      packageDependencies: new Map([
        ["arr-flatten", "1.1.0"],
      ]),
    }],
  ])],
  ["array-unique", new Map([
    ["0.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-array-unique-0.2.1-a1d97ccafcbc2625cc70fadceb36a50c58b01a53/node_modules/array-unique/"),
      packageDependencies: new Map([
        ["array-unique", "0.2.1"],
      ]),
    }],
  ])],
  ["braces", new Map([
    ["1.8.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-braces-1.8.5-ba77962e12dff969d6b76711e914b737857bf6a7/node_modules/braces/"),
      packageDependencies: new Map([
        ["expand-range", "1.8.2"],
        ["preserve", "0.2.0"],
        ["repeat-element", "1.1.3"],
        ["braces", "1.8.5"],
      ]),
    }],
  ])],
  ["expand-range", new Map([
    ["1.8.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-expand-range-1.8.2-a299effd335fe2721ebae8e257ec79644fc85337/node_modules/expand-range/"),
      packageDependencies: new Map([
        ["fill-range", "2.2.4"],
        ["expand-range", "1.8.2"],
      ]),
    }],
  ])],
  ["fill-range", new Map([
    ["2.2.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-fill-range-2.2.4-eb1e773abb056dcd8df2bfdf6af59b8b3a936565/node_modules/fill-range/"),
      packageDependencies: new Map([
        ["is-number", "2.1.0"],
        ["isobject", "2.1.0"],
        ["randomatic", "3.1.1"],
        ["repeat-element", "1.1.3"],
        ["repeat-string", "1.6.1"],
        ["fill-range", "2.2.4"],
      ]),
    }],
  ])],
  ["is-number", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-number-2.1.0-01fcbbb393463a548f2f466cce16dece49db908f/node_modules/is-number/"),
      packageDependencies: new Map([
        ["kind-of", "3.2.2"],
        ["is-number", "2.1.0"],
      ]),
    }],
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-number-4.0.0-0026e37f5454d73e356dfe6564699867c6a7f0ff/node_modules/is-number/"),
      packageDependencies: new Map([
        ["is-number", "4.0.0"],
      ]),
    }],
  ])],
  ["kind-of", new Map([
    ["3.2.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-kind-of-3.2.2-31ea21a734bab9bbb0f32466d893aea51e4a3c64/node_modules/kind-of/"),
      packageDependencies: new Map([
        ["is-buffer", "1.1.6"],
        ["kind-of", "3.2.2"],
      ]),
    }],
    ["6.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-kind-of-6.0.2-01146b36a6218e64e58f3a8d66de5d7fc6f6d051/node_modules/kind-of/"),
      packageDependencies: new Map([
        ["kind-of", "6.0.2"],
      ]),
    }],
  ])],
  ["is-buffer", new Map([
    ["1.1.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-buffer-1.1.6-efaa2ea9daa0d7ab2ea13a97b2b8ad51fefbe8be/node_modules/is-buffer/"),
      packageDependencies: new Map([
        ["is-buffer", "1.1.6"],
      ]),
    }],
  ])],
  ["isobject", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-isobject-2.1.0-f065561096a3f1da2ef46272f815c840d87e0c89/node_modules/isobject/"),
      packageDependencies: new Map([
        ["isarray", "1.0.0"],
        ["isobject", "2.1.0"],
      ]),
    }],
  ])],
  ["randomatic", new Map([
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-randomatic-3.1.1-b776efc59375984e36c537b2f51a1f0aff0da1ed/node_modules/randomatic/"),
      packageDependencies: new Map([
        ["is-number", "4.0.0"],
        ["kind-of", "6.0.2"],
        ["math-random", "1.0.4"],
        ["randomatic", "3.1.1"],
      ]),
    }],
  ])],
  ["math-random", new Map([
    ["1.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-math-random-1.0.4-5dd6943c938548267016d4e34f057583080c514c/node_modules/math-random/"),
      packageDependencies: new Map([
        ["math-random", "1.0.4"],
      ]),
    }],
  ])],
  ["repeat-element", new Map([
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-repeat-element-1.1.3-782e0d825c0c5a3bb39731f84efee6b742e6b1ce/node_modules/repeat-element/"),
      packageDependencies: new Map([
        ["repeat-element", "1.1.3"],
      ]),
    }],
  ])],
  ["repeat-string", new Map([
    ["1.6.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-repeat-string-1.6.1-8dcae470e1c88abc2d600fff4a776286da75e637/node_modules/repeat-string/"),
      packageDependencies: new Map([
        ["repeat-string", "1.6.1"],
      ]),
    }],
  ])],
  ["preserve", new Map([
    ["0.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-preserve-0.2.0-815ed1f6ebc65926f865b310c0713bcb3315ce4b/node_modules/preserve/"),
      packageDependencies: new Map([
        ["preserve", "0.2.0"],
      ]),
    }],
  ])],
  ["expand-brackets", new Map([
    ["0.1.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-expand-brackets-0.1.5-df07284e342a807cd733ac5af72411e581d1177b/node_modules/expand-brackets/"),
      packageDependencies: new Map([
        ["is-posix-bracket", "0.1.1"],
        ["expand-brackets", "0.1.5"],
      ]),
    }],
  ])],
  ["is-posix-bracket", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-posix-bracket-0.1.1-3334dc79774368e92f016e6fbc0a88f5cd6e6bc4/node_modules/is-posix-bracket/"),
      packageDependencies: new Map([
        ["is-posix-bracket", "0.1.1"],
      ]),
    }],
  ])],
  ["extglob", new Map([
    ["0.3.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-extglob-0.3.2-2e18ff3d2f49ab2765cec9023f011daa8d8349a1/node_modules/extglob/"),
      packageDependencies: new Map([
        ["is-extglob", "1.0.0"],
        ["extglob", "0.3.2"],
      ]),
    }],
  ])],
  ["is-extglob", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-extglob-1.0.0-ac468177c4943405a092fc8f29760c6ffc6206c0/node_modules/is-extglob/"),
      packageDependencies: new Map([
        ["is-extglob", "1.0.0"],
      ]),
    }],
  ])],
  ["filename-regex", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-filename-regex-2.0.1-c1c4b9bee3e09725ddb106b75c1e301fe2f18b26/node_modules/filename-regex/"),
      packageDependencies: new Map([
        ["filename-regex", "2.0.1"],
      ]),
    }],
  ])],
  ["is-glob", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-glob-2.0.1-d096f926a3ded5600f3fdfd91198cb0888c2d863/node_modules/is-glob/"),
      packageDependencies: new Map([
        ["is-extglob", "1.0.0"],
        ["is-glob", "2.0.1"],
      ]),
    }],
  ])],
  ["normalize-path", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-normalize-path-2.1.1-1ab28b556e198363a8c1a6f7e6fa20137fe6aed9/node_modules/normalize-path/"),
      packageDependencies: new Map([
        ["remove-trailing-separator", "1.1.0"],
        ["normalize-path", "2.1.1"],
      ]),
    }],
  ])],
  ["remove-trailing-separator", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-remove-trailing-separator-1.1.0-c24bce2a283adad5bc3f58e0d48249b92379d8ef/node_modules/remove-trailing-separator/"),
      packageDependencies: new Map([
        ["remove-trailing-separator", "1.1.0"],
      ]),
    }],
  ])],
  ["object.omit", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-object-omit-2.0.1-1a9c744829f39dbb858c76ca3579ae2a54ebd1fa/node_modules/object.omit/"),
      packageDependencies: new Map([
        ["for-own", "0.1.5"],
        ["is-extendable", "0.1.1"],
        ["object.omit", "2.0.1"],
      ]),
    }],
  ])],
  ["for-own", new Map([
    ["0.1.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-for-own-0.1.5-5265c681a4f294dabbf17c9509b6763aa84510ce/node_modules/for-own/"),
      packageDependencies: new Map([
        ["for-in", "1.0.2"],
        ["for-own", "0.1.5"],
      ]),
    }],
  ])],
  ["for-in", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-for-in-1.0.2-81068d295a8142ec0ac726c6e2200c30fb6d5e80/node_modules/for-in/"),
      packageDependencies: new Map([
        ["for-in", "1.0.2"],
      ]),
    }],
  ])],
  ["is-extendable", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-extendable-0.1.1-62b110e289a471418e3ec36a617d472e301dfc89/node_modules/is-extendable/"),
      packageDependencies: new Map([
        ["is-extendable", "0.1.1"],
      ]),
    }],
  ])],
  ["parse-glob", new Map([
    ["3.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-parse-glob-3.0.4-b2c376cfb11f35513badd173ef0bb6e3a388391c/node_modules/parse-glob/"),
      packageDependencies: new Map([
        ["glob-base", "0.3.0"],
        ["is-dotfile", "1.0.3"],
        ["is-extglob", "1.0.0"],
        ["is-glob", "2.0.1"],
        ["parse-glob", "3.0.4"],
      ]),
    }],
  ])],
  ["glob-base", new Map([
    ["0.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-glob-base-0.3.0-dbb164f6221b1c0b1ccf82aea328b497df0ea3c4/node_modules/glob-base/"),
      packageDependencies: new Map([
        ["glob-parent", "2.0.0"],
        ["is-glob", "2.0.1"],
        ["glob-base", "0.3.0"],
      ]),
    }],
  ])],
  ["glob-parent", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-glob-parent-2.0.0-81383d72db054fcccf5336daa902f182f6edbb28/node_modules/glob-parent/"),
      packageDependencies: new Map([
        ["is-glob", "2.0.1"],
        ["glob-parent", "2.0.0"],
      ]),
    }],
  ])],
  ["is-dotfile", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-dotfile-1.0.3-a6a2f32ffd2dfb04f5ca25ecd0f6b83cf798a1e1/node_modules/is-dotfile/"),
      packageDependencies: new Map([
        ["is-dotfile", "1.0.3"],
      ]),
    }],
  ])],
  ["regex-cache", new Map([
    ["0.4.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-regex-cache-0.4.4-75bdc58a2a1496cec48a12835bc54c8d562336dd/node_modules/regex-cache/"),
      packageDependencies: new Map([
        ["is-equal-shallow", "0.1.3"],
        ["regex-cache", "0.4.4"],
      ]),
    }],
  ])],
  ["is-equal-shallow", new Map([
    ["0.1.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-equal-shallow-0.1.3-2238098fc221de0bcfa5d9eac4c45d638aa1c534/node_modules/is-equal-shallow/"),
      packageDependencies: new Map([
        ["is-primitive", "2.0.0"],
        ["is-equal-shallow", "0.1.3"],
      ]),
    }],
  ])],
  ["is-primitive", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-primitive-2.0.0-207bab91638499c07b2adf240a41a87210034575/node_modules/is-primitive/"),
      packageDependencies: new Map([
        ["is-primitive", "2.0.0"],
      ]),
    }],
  ])],
  ["pkg-up", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-pkg-up-1.0.0-3e08fb461525c4421624a33b9f7e6d0af5b05a26/node_modules/pkg-up/"),
      packageDependencies: new Map([
        ["find-up", "1.1.2"],
        ["pkg-up", "1.0.0"],
      ]),
    }],
  ])],
  ["resolve-from", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-resolve-from-2.0.0-9480ab20e94ffa1d9e80a804c7ea147611966b57/node_modules/resolve-from/"),
      packageDependencies: new Map([
        ["resolve-from", "2.0.0"],
      ]),
    }],
  ])],
  ["spawn-wrap", new Map([
    ["1.4.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-spawn-wrap-1.4.3-81b7670e170cca247d80bf5faf0cfb713bdcf848/node_modules/spawn-wrap/"),
      packageDependencies: new Map([
        ["foreground-child", "1.5.6"],
        ["mkdirp", "0.5.1"],
        ["os-homedir", "1.0.2"],
        ["rimraf", "2.7.1"],
        ["signal-exit", "3.0.2"],
        ["which", "1.3.1"],
        ["spawn-wrap", "1.4.3"],
      ]),
    }],
  ])],
  ["os-homedir", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-os-homedir-1.0.2-ffbc4988336e0e833de0c168c7ef152121aa7fb3/node_modules/os-homedir/"),
      packageDependencies: new Map([
        ["os-homedir", "1.0.2"],
      ]),
    }],
  ])],
  ["test-exclude", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-test-exclude-1.1.0-f5ddd718927b12fd02f270a0aa939ceb6eea4151/node_modules/test-exclude/"),
      packageDependencies: new Map([
        ["arrify", "1.0.1"],
        ["lodash.assign", "4.2.0"],
        ["micromatch", "2.3.11"],
        ["read-pkg-up", "1.0.1"],
        ["require-main-filename", "1.0.1"],
        ["test-exclude", "1.1.0"],
      ]),
    }],
  ])],
  ["lodash.assign", new Map([
    ["4.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-lodash-assign-4.2.0-0d99f3ccd7a6d261d19bdaeb9245005d285808e7/node_modules/lodash.assign/"),
      packageDependencies: new Map([
        ["lodash.assign", "4.2.0"],
      ]),
    }],
  ])],
  ["read-pkg-up", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-read-pkg-up-1.0.1-9d63c13276c065918d57f002a57f40a1b643fb02/node_modules/read-pkg-up/"),
      packageDependencies: new Map([
        ["find-up", "1.1.2"],
        ["read-pkg", "1.1.0"],
        ["read-pkg-up", "1.0.1"],
      ]),
    }],
  ])],
  ["read-pkg", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-read-pkg-1.1.0-f5ffaa5ecd29cb31c0474bca7d756b6bb29e3f28/node_modules/read-pkg/"),
      packageDependencies: new Map([
        ["load-json-file", "1.1.0"],
        ["normalize-package-data", "2.5.0"],
        ["path-type", "1.1.0"],
        ["read-pkg", "1.1.0"],
      ]),
    }],
  ])],
  ["load-json-file", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-load-json-file-1.1.0-956905708d58b4bab4c2261b04f59f31c99374c0/node_modules/load-json-file/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.2"],
        ["parse-json", "2.2.0"],
        ["pify", "2.3.0"],
        ["pinkie-promise", "2.0.1"],
        ["strip-bom", "2.0.0"],
        ["load-json-file", "1.1.0"],
      ]),
    }],
  ])],
  ["parse-json", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-parse-json-2.2.0-f480f40434ef80741f8469099f8dea18f55a4dc9/node_modules/parse-json/"),
      packageDependencies: new Map([
        ["error-ex", "1.3.2"],
        ["parse-json", "2.2.0"],
      ]),
    }],
  ])],
  ["error-ex", new Map([
    ["1.3.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-error-ex-1.3.2-b4ac40648107fdcdcfae242f428bea8a14d4f1bf/node_modules/error-ex/"),
      packageDependencies: new Map([
        ["is-arrayish", "0.2.1"],
        ["error-ex", "1.3.2"],
      ]),
    }],
  ])],
  ["is-arrayish", new Map([
    ["0.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-arrayish-0.2.1-77c99840527aa8ecb1a8ba697b80645a7a926a9d/node_modules/is-arrayish/"),
      packageDependencies: new Map([
        ["is-arrayish", "0.2.1"],
      ]),
    }],
  ])],
  ["pify", new Map([
    ["2.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-pify-2.3.0-ed141a6ac043a849ea588498e7dca8b15330e90c/node_modules/pify/"),
      packageDependencies: new Map([
        ["pify", "2.3.0"],
      ]),
    }],
  ])],
  ["normalize-package-data", new Map([
    ["2.5.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-normalize-package-data-2.5.0-e66db1838b200c1dfc233225d12cb36520e234a8/node_modules/normalize-package-data/"),
      packageDependencies: new Map([
        ["hosted-git-info", "2.8.4"],
        ["resolve", "1.12.0"],
        ["semver", "5.7.1"],
        ["validate-npm-package-license", "3.0.4"],
        ["normalize-package-data", "2.5.0"],
      ]),
    }],
  ])],
  ["hosted-git-info", new Map([
    ["2.8.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-hosted-git-info-2.8.4-44119abaf4bc64692a16ace34700fed9c03e2546/node_modules/hosted-git-info/"),
      packageDependencies: new Map([
        ["hosted-git-info", "2.8.4"],
      ]),
    }],
  ])],
  ["path-parse", new Map([
    ["1.0.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-path-parse-1.0.6-d62dbb5679405d72c4737ec58600e9ddcf06d24c/node_modules/path-parse/"),
      packageDependencies: new Map([
        ["path-parse", "1.0.6"],
      ]),
    }],
  ])],
  ["validate-npm-package-license", new Map([
    ["3.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-validate-npm-package-license-3.0.4-fc91f6b9c7ba15c857f4cb2c5defeec39d4f410a/node_modules/validate-npm-package-license/"),
      packageDependencies: new Map([
        ["spdx-correct", "3.1.0"],
        ["spdx-expression-parse", "3.0.0"],
        ["validate-npm-package-license", "3.0.4"],
      ]),
    }],
  ])],
  ["spdx-correct", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-spdx-correct-3.1.0-fb83e504445268f154b074e218c87c003cd31df4/node_modules/spdx-correct/"),
      packageDependencies: new Map([
        ["spdx-expression-parse", "3.0.0"],
        ["spdx-license-ids", "3.0.5"],
        ["spdx-correct", "3.1.0"],
      ]),
    }],
  ])],
  ["spdx-expression-parse", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-spdx-expression-parse-3.0.0-99e119b7a5da00e05491c9fa338b7904823b41d0/node_modules/spdx-expression-parse/"),
      packageDependencies: new Map([
        ["spdx-exceptions", "2.2.0"],
        ["spdx-license-ids", "3.0.5"],
        ["spdx-expression-parse", "3.0.0"],
      ]),
    }],
  ])],
  ["spdx-exceptions", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-spdx-exceptions-2.2.0-2ea450aee74f2a89bfb94519c07fcd6f41322977/node_modules/spdx-exceptions/"),
      packageDependencies: new Map([
        ["spdx-exceptions", "2.2.0"],
      ]),
    }],
  ])],
  ["spdx-license-ids", new Map([
    ["3.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-spdx-license-ids-3.0.5-3694b5804567a458d3c8045842a6358632f62654/node_modules/spdx-license-ids/"),
      packageDependencies: new Map([
        ["spdx-license-ids", "3.0.5"],
      ]),
    }],
  ])],
  ["path-type", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-path-type-1.1.0-59c44f7ee491da704da415da5a4070ba4f8fe441/node_modules/path-type/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.2"],
        ["pify", "2.3.0"],
        ["pinkie-promise", "2.0.1"],
        ["path-type", "1.1.0"],
      ]),
    }],
  ])],
  ["require-main-filename", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-require-main-filename-1.0.1-97f717b69d48784f5f526a6c5aa8ffdda055a4d1/node_modules/require-main-filename/"),
      packageDependencies: new Map([
        ["require-main-filename", "1.0.1"],
      ]),
    }],
  ])],
  ["yargs", new Map([
    ["4.8.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-yargs-4.8.1-c0c42924ca4aaa6b0e6da1739dfb216439f9ddc0/node_modules/yargs/"),
      packageDependencies: new Map([
        ["cliui", "3.2.0"],
        ["decamelize", "1.2.0"],
        ["get-caller-file", "1.0.3"],
        ["lodash.assign", "4.2.0"],
        ["os-locale", "1.4.0"],
        ["read-pkg-up", "1.0.1"],
        ["require-directory", "2.1.1"],
        ["require-main-filename", "1.0.1"],
        ["set-blocking", "2.0.0"],
        ["string-width", "1.0.2"],
        ["which-module", "1.0.0"],
        ["window-size", "0.2.0"],
        ["y18n", "3.2.1"],
        ["yargs-parser", "2.4.1"],
        ["yargs", "4.8.1"],
      ]),
    }],
  ])],
  ["cliui", new Map([
    ["3.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-cliui-3.2.0-120601537a916d29940f934da3b48d585a39213d/node_modules/cliui/"),
      packageDependencies: new Map([
        ["string-width", "1.0.2"],
        ["strip-ansi", "3.0.1"],
        ["wrap-ansi", "2.1.0"],
        ["cliui", "3.2.0"],
      ]),
    }],
  ])],
  ["string-width", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-string-width-1.0.2-118bdf5b8cdc51a2a7e70d211e07e2b0b9b107d3/node_modules/string-width/"),
      packageDependencies: new Map([
        ["code-point-at", "1.1.0"],
        ["is-fullwidth-code-point", "1.0.0"],
        ["strip-ansi", "3.0.1"],
        ["string-width", "1.0.2"],
      ]),
    }],
  ])],
  ["code-point-at", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-code-point-at-1.1.0-0d070b4d043a5bea33a2f1a40e2edb3d9a4ccf77/node_modules/code-point-at/"),
      packageDependencies: new Map([
        ["code-point-at", "1.1.0"],
      ]),
    }],
  ])],
  ["is-fullwidth-code-point", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-is-fullwidth-code-point-1.0.0-ef9e31386f031a7f0d643af82fde50c457ef00cb/node_modules/is-fullwidth-code-point/"),
      packageDependencies: new Map([
        ["number-is-nan", "1.0.1"],
        ["is-fullwidth-code-point", "1.0.0"],
      ]),
    }],
  ])],
  ["number-is-nan", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-number-is-nan-1.0.1-097b602b53422a522c1afb8790318336941a011d/node_modules/number-is-nan/"),
      packageDependencies: new Map([
        ["number-is-nan", "1.0.1"],
      ]),
    }],
  ])],
  ["wrap-ansi", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-wrap-ansi-2.1.0-d8fc3d284dd05794fe84973caecdd1cf824fdd85/node_modules/wrap-ansi/"),
      packageDependencies: new Map([
        ["string-width", "1.0.2"],
        ["strip-ansi", "3.0.1"],
        ["wrap-ansi", "2.1.0"],
      ]),
    }],
  ])],
  ["decamelize", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-decamelize-1.2.0-f6534d15148269b20352e7bee26f501f9a191290/node_modules/decamelize/"),
      packageDependencies: new Map([
        ["decamelize", "1.2.0"],
      ]),
    }],
  ])],
  ["get-caller-file", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-get-caller-file-1.0.3-f978fa4c90d1dfe7ff2d6beda2a515e713bdcf4a/node_modules/get-caller-file/"),
      packageDependencies: new Map([
        ["get-caller-file", "1.0.3"],
      ]),
    }],
  ])],
  ["os-locale", new Map([
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-os-locale-1.4.0-20f9f17ae29ed345e8bde583b13d2009803c14d9/node_modules/os-locale/"),
      packageDependencies: new Map([
        ["lcid", "1.0.0"],
        ["os-locale", "1.4.0"],
      ]),
    }],
  ])],
  ["lcid", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-lcid-1.0.0-308accafa0bc483a3867b4b6f2b9506251d1b835/node_modules/lcid/"),
      packageDependencies: new Map([
        ["invert-kv", "1.0.0"],
        ["lcid", "1.0.0"],
      ]),
    }],
  ])],
  ["invert-kv", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-invert-kv-1.0.0-104a8e4aaca6d3d8cd157a8ef8bfab2d7a3ffdb6/node_modules/invert-kv/"),
      packageDependencies: new Map([
        ["invert-kv", "1.0.0"],
      ]),
    }],
  ])],
  ["require-directory", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-require-directory-2.1.1-8c64ad5fd30dab1c976e2344ffe7f792a6a6df42/node_modules/require-directory/"),
      packageDependencies: new Map([
        ["require-directory", "2.1.1"],
      ]),
    }],
  ])],
  ["set-blocking", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-set-blocking-2.0.0-045f9782d011ae9a6803ddd382b24392b3d890f7/node_modules/set-blocking/"),
      packageDependencies: new Map([
        ["set-blocking", "2.0.0"],
      ]),
    }],
  ])],
  ["which-module", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-which-module-1.0.0-bba63ca861948994ff307736089e3b96026c2a4f/node_modules/which-module/"),
      packageDependencies: new Map([
        ["which-module", "1.0.0"],
      ]),
    }],
  ])],
  ["window-size", new Map([
    ["0.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-window-size-0.2.0-b4315bb4214a3d7058ebeee892e13fa24d98b075/node_modules/window-size/"),
      packageDependencies: new Map([
        ["window-size", "0.2.0"],
      ]),
    }],
  ])],
  ["y18n", new Map([
    ["3.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-y18n-3.2.1-6d15fba884c08679c0d77e88e7759e811e07fa41/node_modules/y18n/"),
      packageDependencies: new Map([
        ["y18n", "3.2.1"],
      ]),
    }],
  ])],
  ["yargs-parser", new Map([
    ["2.4.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-yargs-parser-2.4.1-85568de3cf150ff49fa51825f03a8c880ddcc5c4/node_modules/yargs-parser/"),
      packageDependencies: new Map([
        ["camelcase", "3.0.0"],
        ["lodash.assign", "4.2.0"],
        ["yargs-parser", "2.4.1"],
      ]),
    }],
  ])],
  ["camelcase", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-camelcase-3.0.0-32fc4b9fcdaf845fcdf7e73bb97cac2261f0ab0a/node_modules/camelcase/"),
      packageDependencies: new Map([
        ["camelcase", "3.0.0"],
      ]),
    }],
  ])],
  ["only-shallow", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-only-shallow-1.2.0-71cecedba9324bc0518aef10ec080d3249dc2465/node_modules/only-shallow/"),
      packageDependencies: new Map([
        ["only-shallow", "1.2.0"],
      ]),
    }],
  ])],
  ["opener", new Map([
    ["1.5.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-opener-1.5.1-6d2f0e77f1a0af0032aca716c2c1fbb8e7e8abed/node_modules/opener/"),
      packageDependencies: new Map([
        ["opener", "1.5.1"],
      ]),
    }],
  ])],
  ["process-nextick-args", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-process-nextick-args-2.0.1-7820d9b16120cc55ca9ae7792680ae7dba6d7fe2/node_modules/process-nextick-args/"),
      packageDependencies: new Map([
        ["process-nextick-args", "2.0.1"],
      ]),
    }],
    ["1.0.7", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-process-nextick-args-1.0.7-150e20b756590ad3f91093f25a4f2ad8bff30ba3/node_modules/process-nextick-args/"),
      packageDependencies: new Map([
        ["process-nextick-args", "1.0.7"],
      ]),
    }],
  ])],
  ["util-deprecate", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-util-deprecate-1.0.2-450d4dc9fa70de732762fbd2d4a28981419a0ccf/node_modules/util-deprecate/"),
      packageDependencies: new Map([
        ["util-deprecate", "1.0.2"],
      ]),
    }],
  ])],
  ["stack-utils", new Map([
    ["0.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-stack-utils-0.4.0-940cb82fccfa84e8ff2f3fdf293fe78016beccd1/node_modules/stack-utils/"),
      packageDependencies: new Map([
        ["stack-utils", "0.4.0"],
      ]),
    }],
  ])],
  ["tap-mocha-reporter", new Map([
    ["0.0.27", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-tap-mocha-reporter-0.0.27-b2f72f3e1e8ba780ee02918fcdeb3a40da8018f7/node_modules/tap-mocha-reporter/"),
      packageDependencies: new Map([
        ["color-support", "1.1.3"],
        ["debug", "2.6.9"],
        ["diff", "1.4.0"],
        ["escape-string-regexp", "1.0.5"],
        ["glob", "7.1.4"],
        ["js-yaml", "3.13.1"],
        ["tap-parser", "1.3.2"],
        ["unicode-length", "1.0.3"],
        ["readable-stream", "1.1.14"],
        ["tap-mocha-reporter", "0.0.27"],
      ]),
    }],
  ])],
  ["color-support", new Map([
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-color-support-1.1.3-93834379a1cc9a0c61f82f52f0d04322251bd5a2/node_modules/color-support/"),
      packageDependencies: new Map([
        ["color-support", "1.1.3"],
      ]),
    }],
  ])],
  ["diff", new Map([
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-diff-1.4.0-7f28d2eb9ee7b15a97efd89ce63dcfdaa3ccbabf/node_modules/diff/"),
      packageDependencies: new Map([
        ["diff", "1.4.0"],
      ]),
    }],
  ])],
  ["tap-parser", new Map([
    ["1.3.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-tap-parser-1.3.2-120c5089c88c3c8a793ef288867de321e18f8c22/node_modules/tap-parser/"),
      packageDependencies: new Map([
        ["events-to-array", "1.1.2"],
        ["inherits", "2.0.4"],
        ["js-yaml", "3.13.1"],
        ["readable-stream", "2.3.6"],
        ["tap-parser", "1.3.2"],
      ]),
    }],
  ])],
  ["events-to-array", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-events-to-array-1.1.2-2d41f563e1fe400ed4962fe1a4d5c6a7539df7f6/node_modules/events-to-array/"),
      packageDependencies: new Map([
        ["events-to-array", "1.1.2"],
      ]),
    }],
  ])],
  ["unicode-length", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-unicode-length-1.0.3-5ada7a7fed51841a418a328cf149478ac8358abb/node_modules/unicode-length/"),
      packageDependencies: new Map([
        ["punycode", "1.4.1"],
        ["strip-ansi", "3.0.1"],
        ["unicode-length", "1.0.3"],
      ]),
    }],
  ])],
  ["tmatch", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-tmatch-2.0.1-0c56246f33f30da1b8d3d72895abaf16660f38cf/node_modules/tmatch/"),
      packageDependencies: new Map([
        ["tmatch", "2.0.1"],
      ]),
    }],
  ])],
  ["browserify", new Map([
    ["13.3.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-browserify-13.3.0-b5a9c9020243f0c70e4675bec8223bc627e415ce/node_modules/browserify/"),
      packageDependencies: new Map([
        ["JSONStream", "1.3.5"],
        ["assert", "1.5.0"],
        ["browser-pack", "6.1.0"],
        ["browser-resolve", "1.11.3"],
        ["browserify-zlib", "0.1.4"],
        ["buffer", "4.9.1"],
        ["cached-path-relative", "1.0.2"],
        ["concat-stream", "1.5.2"],
        ["console-browserify", "1.1.0"],
        ["constants-browserify", "1.0.0"],
        ["crypto-browserify", "3.12.0"],
        ["defined", "1.0.0"],
        ["deps-sort", "2.0.0"],
        ["domain-browser", "1.1.7"],
        ["duplexer2", "0.1.4"],
        ["events", "1.1.1"],
        ["glob", "7.1.4"],
        ["has", "1.0.3"],
        ["htmlescape", "1.1.1"],
        ["https-browserify", "0.0.1"],
        ["inherits", "2.0.4"],
        ["insert-module-globals", "7.2.0"],
        ["labeled-stream-splicer", "2.0.2"],
        ["module-deps", "4.1.1"],
        ["os-browserify", "0.1.2"],
        ["parents", "1.0.1"],
        ["path-browserify", "0.0.1"],
        ["process", "0.11.10"],
        ["punycode", "1.4.1"],
        ["querystring-es3", "0.2.1"],
        ["read-only-stream", "2.0.0"],
        ["readable-stream", "2.3.6"],
        ["resolve", "1.12.0"],
        ["shasum", "1.0.2"],
        ["shell-quote", "1.7.2"],
        ["stream-browserify", "2.0.2"],
        ["stream-http", "2.8.3"],
        ["string_decoder", "0.10.31"],
        ["subarg", "1.0.0"],
        ["syntax-error", "1.4.0"],
        ["through2", "2.0.5"],
        ["timers-browserify", "1.4.2"],
        ["tty-browserify", "0.0.1"],
        ["url", "0.11.0"],
        ["util", "0.10.4"],
        ["vm-browserify", "0.0.4"],
        ["xtend", "4.0.2"],
        ["browserify", "13.3.0"],
      ]),
    }],
  ])],
  ["JSONStream", new Map([
    ["1.3.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-tream-1.3.5-3208c1f08d3a4d99261ab64f92302bc15e111ca0/node_modules/JSONStream/"),
      packageDependencies: new Map([
        ["jsonparse", "1.3.1"],
        ["through", "2.3.8"],
        ["JSONStream", "1.3.5"],
      ]),
    }],
  ])],
  ["jsonparse", new Map([
    ["1.3.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-jsonparse-1.3.1-3f4dae4a91fac315f71062f8521cc239f1366280/node_modules/jsonparse/"),
      packageDependencies: new Map([
        ["jsonparse", "1.3.1"],
      ]),
    }],
  ])],
  ["assert", new Map([
    ["1.5.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-assert-1.5.0-55c109aaf6e0aefdb3dc4b71240c70bf574b18eb/node_modules/assert/"),
      packageDependencies: new Map([
        ["object-assign", "4.1.1"],
        ["util", "0.10.3"],
        ["assert", "1.5.0"],
      ]),
    }],
  ])],
  ["object-assign", new Map([
    ["4.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-object-assign-4.1.1-2109adc7965887cfc05cbbd442cac8bfbb360863/node_modules/object-assign/"),
      packageDependencies: new Map([
        ["object-assign", "4.1.1"],
      ]),
    }],
  ])],
  ["util", new Map([
    ["0.10.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-util-0.10.3-7afb1afe50805246489e3db7fe0ed379336ac0f9/node_modules/util/"),
      packageDependencies: new Map([
        ["inherits", "2.0.1"],
        ["util", "0.10.3"],
      ]),
    }],
    ["0.10.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-util-0.10.4-3aa0125bfe668a4672de58857d3ace27ecb76901/node_modules/util/"),
      packageDependencies: new Map([
        ["inherits", "2.0.3"],
        ["util", "0.10.4"],
      ]),
    }],
  ])],
  ["browser-pack", new Map([
    ["6.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-browser-pack-6.1.0-c34ba10d0b9ce162b5af227c7131c92c2ecd5774/node_modules/browser-pack/"),
      packageDependencies: new Map([
        ["JSONStream", "1.3.5"],
        ["combine-source-map", "0.8.0"],
        ["defined", "1.0.0"],
        ["safe-buffer", "5.2.0"],
        ["through2", "2.0.5"],
        ["umd", "3.0.3"],
        ["browser-pack", "6.1.0"],
      ]),
    }],
  ])],
  ["combine-source-map", new Map([
    ["0.8.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-combine-source-map-0.8.0-a58d0df042c186fcf822a8e8015f5450d2d79a8b/node_modules/combine-source-map/"),
      packageDependencies: new Map([
        ["convert-source-map", "1.1.3"],
        ["inline-source-map", "0.6.2"],
        ["lodash.memoize", "3.0.4"],
        ["source-map", "0.5.7"],
        ["combine-source-map", "0.8.0"],
      ]),
    }],
  ])],
  ["inline-source-map", new Map([
    ["0.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-inline-source-map-0.6.2-f9393471c18a79d1724f863fa38b586370ade2a5/node_modules/inline-source-map/"),
      packageDependencies: new Map([
        ["source-map", "0.5.7"],
        ["inline-source-map", "0.6.2"],
      ]),
    }],
  ])],
  ["lodash.memoize", new Map([
    ["3.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-lodash-memoize-3.0.4-2dcbd2c287cbc0a55cc42328bd0c736150d53e3f/node_modules/lodash.memoize/"),
      packageDependencies: new Map([
        ["lodash.memoize", "3.0.4"],
      ]),
    }],
  ])],
  ["through2", new Map([
    ["2.0.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-through2-2.0.5-01c1e39eb31d07cb7d03a96a70823260b23132cd/node_modules/through2/"),
      packageDependencies: new Map([
        ["readable-stream", "2.3.6"],
        ["xtend", "4.0.2"],
        ["through2", "2.0.5"],
      ]),
    }],
  ])],
  ["umd", new Map([
    ["3.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-umd-3.0.3-aa9fe653c42b9097678489c01000acb69f0b26cf/node_modules/umd/"),
      packageDependencies: new Map([
        ["umd", "3.0.3"],
      ]),
    }],
  ])],
  ["browser-resolve", new Map([
    ["1.11.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-browser-resolve-1.11.3-9b7cbb3d0f510e4cb86bdbd796124d28b5890af6/node_modules/browser-resolve/"),
      packageDependencies: new Map([
        ["resolve", "1.1.7"],
        ["browser-resolve", "1.11.3"],
      ]),
    }],
  ])],
  ["browserify-zlib", new Map([
    ["0.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-browserify-zlib-0.1.4-bb35f8a519f600e0fa6b8485241c979d0141fb2d/node_modules/browserify-zlib/"),
      packageDependencies: new Map([
        ["pako", "0.2.9"],
        ["browserify-zlib", "0.1.4"],
      ]),
    }],
  ])],
  ["pako", new Map([
    ["0.2.9", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-pako-0.2.9-f3f7522f4ef782348da8161bad9ecfd51bf83a75/node_modules/pako/"),
      packageDependencies: new Map([
        ["pako", "0.2.9"],
      ]),
    }],
  ])],
  ["buffer", new Map([
    ["4.9.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-buffer-4.9.1-6d1bb601b07a4efced97094132093027c95bc298/node_modules/buffer/"),
      packageDependencies: new Map([
        ["base64-js", "1.3.1"],
        ["ieee754", "1.1.13"],
        ["isarray", "1.0.0"],
        ["buffer", "4.9.1"],
      ]),
    }],
  ])],
  ["base64-js", new Map([
    ["1.3.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-base64-js-1.3.1-58ece8cb75dd07e71ed08c736abc5fac4dbf8df1/node_modules/base64-js/"),
      packageDependencies: new Map([
        ["base64-js", "1.3.1"],
      ]),
    }],
  ])],
  ["ieee754", new Map([
    ["1.1.13", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ieee754-1.1.13-ec168558e95aa181fd87d37f55c32bbcb6708b84/node_modules/ieee754/"),
      packageDependencies: new Map([
        ["ieee754", "1.1.13"],
      ]),
    }],
  ])],
  ["cached-path-relative", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-cached-path-relative-1.0.2-a13df4196d26776220cc3356eb147a52dba2c6db/node_modules/cached-path-relative/"),
      packageDependencies: new Map([
        ["cached-path-relative", "1.0.2"],
      ]),
    }],
  ])],
  ["concat-stream", new Map([
    ["1.5.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-concat-stream-1.5.2-708978624d856af41a5a741defdd261da752c266/node_modules/concat-stream/"),
      packageDependencies: new Map([
        ["inherits", "2.0.4"],
        ["readable-stream", "2.0.6"],
        ["typedarray", "0.0.6"],
        ["concat-stream", "1.5.2"],
      ]),
    }],
    ["1.6.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-concat-stream-1.6.2-904bdf194cd3122fc675c77fc4ac3d4ff0fd1a34/node_modules/concat-stream/"),
      packageDependencies: new Map([
        ["buffer-from", "1.1.1"],
        ["inherits", "2.0.4"],
        ["readable-stream", "2.3.6"],
        ["typedarray", "0.0.6"],
        ["concat-stream", "1.6.2"],
      ]),
    }],
  ])],
  ["typedarray", new Map([
    ["0.0.6", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-typedarray-0.0.6-867ac74e3864187b1d3d47d996a78ec5c8830777/node_modules/typedarray/"),
      packageDependencies: new Map([
        ["typedarray", "0.0.6"],
      ]),
    }],
  ])],
  ["console-browserify", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-console-browserify-1.1.0-f0241c45730a9fc6323b206dbf38edc741d0bb10/node_modules/console-browserify/"),
      packageDependencies: new Map([
        ["date-now", "0.1.4"],
        ["console-browserify", "1.1.0"],
      ]),
    }],
  ])],
  ["date-now", new Map([
    ["0.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-date-now-0.1.4-eaf439fd4d4848ad74e5cc7dbef200672b9e345b/node_modules/date-now/"),
      packageDependencies: new Map([
        ["date-now", "0.1.4"],
      ]),
    }],
  ])],
  ["constants-browserify", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-constants-browserify-1.0.0-c20b96d8c617748aaf1c16021760cd27fcb8cb75/node_modules/constants-browserify/"),
      packageDependencies: new Map([
        ["constants-browserify", "1.0.0"],
      ]),
    }],
  ])],
  ["crypto-browserify", new Map([
    ["3.12.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-crypto-browserify-3.12.0-396cf9f3137f03e4b8e532c58f698254e00f80ec/node_modules/crypto-browserify/"),
      packageDependencies: new Map([
        ["browserify-cipher", "1.0.1"],
        ["browserify-sign", "4.0.4"],
        ["create-ecdh", "4.0.3"],
        ["create-hash", "1.2.0"],
        ["create-hmac", "1.1.7"],
        ["diffie-hellman", "5.0.3"],
        ["inherits", "2.0.4"],
        ["pbkdf2", "3.0.17"],
        ["public-encrypt", "4.0.3"],
        ["randombytes", "2.1.0"],
        ["randomfill", "1.0.4"],
        ["crypto-browserify", "3.12.0"],
      ]),
    }],
  ])],
  ["browserify-cipher", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-browserify-cipher-1.0.1-8d6474c1b870bfdabcd3bcfcc1934a10e94f15f0/node_modules/browserify-cipher/"),
      packageDependencies: new Map([
        ["browserify-aes", "1.2.0"],
        ["browserify-des", "1.0.2"],
        ["evp_bytestokey", "1.0.3"],
        ["browserify-cipher", "1.0.1"],
      ]),
    }],
  ])],
  ["browserify-aes", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-browserify-aes-1.2.0-326734642f403dabc3003209853bb70ad428ef48/node_modules/browserify-aes/"),
      packageDependencies: new Map([
        ["buffer-xor", "1.0.3"],
        ["cipher-base", "1.0.4"],
        ["create-hash", "1.2.0"],
        ["evp_bytestokey", "1.0.3"],
        ["inherits", "2.0.4"],
        ["safe-buffer", "5.2.0"],
        ["browserify-aes", "1.2.0"],
      ]),
    }],
  ])],
  ["buffer-xor", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-buffer-xor-1.0.3-26e61ed1422fb70dd42e6e36729ed51d855fe8d9/node_modules/buffer-xor/"),
      packageDependencies: new Map([
        ["buffer-xor", "1.0.3"],
      ]),
    }],
  ])],
  ["cipher-base", new Map([
    ["1.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-cipher-base-1.0.4-8760e4ecc272f4c363532f926d874aae2c1397de/node_modules/cipher-base/"),
      packageDependencies: new Map([
        ["inherits", "2.0.4"],
        ["safe-buffer", "5.2.0"],
        ["cipher-base", "1.0.4"],
      ]),
    }],
  ])],
  ["create-hash", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-create-hash-1.2.0-889078af11a63756bcfb59bd221996be3a9ef196/node_modules/create-hash/"),
      packageDependencies: new Map([
        ["cipher-base", "1.0.4"],
        ["inherits", "2.0.4"],
        ["md5.js", "1.3.5"],
        ["ripemd160", "2.0.2"],
        ["sha.js", "2.4.11"],
        ["create-hash", "1.2.0"],
      ]),
    }],
  ])],
  ["md5.js", new Map([
    ["1.3.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-md5-js-1.3.5-b5d07b8e3216e3e27cd728d72f70d1e6a342005f/node_modules/md5.js/"),
      packageDependencies: new Map([
        ["hash-base", "3.0.4"],
        ["inherits", "2.0.4"],
        ["safe-buffer", "5.2.0"],
        ["md5.js", "1.3.5"],
      ]),
    }],
  ])],
  ["hash-base", new Map([
    ["3.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-hash-base-3.0.4-5fc8686847ecd73499403319a6b0a3f3f6ae4918/node_modules/hash-base/"),
      packageDependencies: new Map([
        ["inherits", "2.0.4"],
        ["safe-buffer", "5.2.0"],
        ["hash-base", "3.0.4"],
      ]),
    }],
  ])],
  ["ripemd160", new Map([
    ["2.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-ripemd160-2.0.2-a1c1a6f624751577ba5d07914cbc92850585890c/node_modules/ripemd160/"),
      packageDependencies: new Map([
        ["hash-base", "3.0.4"],
        ["inherits", "2.0.4"],
        ["ripemd160", "2.0.2"],
      ]),
    }],
  ])],
  ["sha.js", new Map([
    ["2.4.11", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-sha-js-2.4.11-37a5cf0b81ecbc6943de109ba2960d1b26584ae7/node_modules/sha.js/"),
      packageDependencies: new Map([
        ["inherits", "2.0.4"],
        ["safe-buffer", "5.2.0"],
        ["sha.js", "2.4.11"],
      ]),
    }],
  ])],
  ["evp_bytestokey", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-evp-bytestokey-1.0.3-7fcbdb198dc71959432efe13842684e0525acb02/node_modules/evp_bytestokey/"),
      packageDependencies: new Map([
        ["md5.js", "1.3.5"],
        ["safe-buffer", "5.2.0"],
        ["evp_bytestokey", "1.0.3"],
      ]),
    }],
  ])],
  ["browserify-des", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-browserify-des-1.0.2-3af4f1f59839403572f1c66204375f7a7f703e9c/node_modules/browserify-des/"),
      packageDependencies: new Map([
        ["cipher-base", "1.0.4"],
        ["des.js", "1.0.0"],
        ["inherits", "2.0.4"],
        ["safe-buffer", "5.2.0"],
        ["browserify-des", "1.0.2"],
      ]),
    }],
  ])],
  ["des.js", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-des-js-1.0.0-c074d2e2aa6a8a9a07dbd61f9a15c2cd83ec8ecc/node_modules/des.js/"),
      packageDependencies: new Map([
        ["inherits", "2.0.4"],
        ["minimalistic-assert", "1.0.1"],
        ["des.js", "1.0.0"],
      ]),
    }],
  ])],
  ["minimalistic-assert", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-minimalistic-assert-1.0.1-2e194de044626d4a10e7f7fbc00ce73e83e4d5c7/node_modules/minimalistic-assert/"),
      packageDependencies: new Map([
        ["minimalistic-assert", "1.0.1"],
      ]),
    }],
  ])],
  ["browserify-sign", new Map([
    ["4.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-browserify-sign-4.0.4-aa4eb68e5d7b658baa6bf6a57e630cbd7a93d298/node_modules/browserify-sign/"),
      packageDependencies: new Map([
        ["bn.js", "4.11.8"],
        ["browserify-rsa", "4.0.1"],
        ["create-hash", "1.2.0"],
        ["create-hmac", "1.1.7"],
        ["elliptic", "6.5.1"],
        ["inherits", "2.0.4"],
        ["parse-asn1", "5.1.5"],
        ["browserify-sign", "4.0.4"],
      ]),
    }],
  ])],
  ["bn.js", new Map([
    ["4.11.8", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-bn-js-4.11.8-2cde09eb5ee341f484746bb0309b3253b1b1442f/node_modules/bn.js/"),
      packageDependencies: new Map([
        ["bn.js", "4.11.8"],
      ]),
    }],
  ])],
  ["browserify-rsa", new Map([
    ["4.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-browserify-rsa-4.0.1-21e0abfaf6f2029cf2fafb133567a701d4135524/node_modules/browserify-rsa/"),
      packageDependencies: new Map([
        ["bn.js", "4.11.8"],
        ["randombytes", "2.1.0"],
        ["browserify-rsa", "4.0.1"],
      ]),
    }],
  ])],
  ["randombytes", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-randombytes-2.1.0-df6f84372f0270dc65cdf6291349ab7a473d4f2a/node_modules/randombytes/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.2.0"],
        ["randombytes", "2.1.0"],
      ]),
    }],
  ])],
  ["create-hmac", new Map([
    ["1.1.7", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-create-hmac-1.1.7-69170c78b3ab957147b2b8b04572e47ead2243ff/node_modules/create-hmac/"),
      packageDependencies: new Map([
        ["cipher-base", "1.0.4"],
        ["create-hash", "1.2.0"],
        ["inherits", "2.0.4"],
        ["ripemd160", "2.0.2"],
        ["safe-buffer", "5.2.0"],
        ["sha.js", "2.4.11"],
        ["create-hmac", "1.1.7"],
      ]),
    }],
  ])],
  ["elliptic", new Map([
    ["6.5.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-elliptic-6.5.1-c380f5f909bf1b9b4428d028cd18d3b0efd6b52b/node_modules/elliptic/"),
      packageDependencies: new Map([
        ["bn.js", "4.11.8"],
        ["brorand", "1.1.0"],
        ["hash.js", "1.1.7"],
        ["hmac-drbg", "1.0.1"],
        ["inherits", "2.0.4"],
        ["minimalistic-assert", "1.0.1"],
        ["minimalistic-crypto-utils", "1.0.1"],
        ["elliptic", "6.5.1"],
      ]),
    }],
  ])],
  ["brorand", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-brorand-1.1.0-12c25efe40a45e3c323eb8675a0a0ce57b22371f/node_modules/brorand/"),
      packageDependencies: new Map([
        ["brorand", "1.1.0"],
      ]),
    }],
  ])],
  ["hash.js", new Map([
    ["1.1.7", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-hash-js-1.1.7-0babca538e8d4ee4a0f8988d68866537a003cf42/node_modules/hash.js/"),
      packageDependencies: new Map([
        ["inherits", "2.0.4"],
        ["minimalistic-assert", "1.0.1"],
        ["hash.js", "1.1.7"],
      ]),
    }],
  ])],
  ["hmac-drbg", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-hmac-drbg-1.0.1-d2745701025a6c775a6c545793ed502fc0c649a1/node_modules/hmac-drbg/"),
      packageDependencies: new Map([
        ["hash.js", "1.1.7"],
        ["minimalistic-assert", "1.0.1"],
        ["minimalistic-crypto-utils", "1.0.1"],
        ["hmac-drbg", "1.0.1"],
      ]),
    }],
  ])],
  ["minimalistic-crypto-utils", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-minimalistic-crypto-utils-1.0.1-f6c00c1c0b082246e5c4d99dfb8c7c083b2b582a/node_modules/minimalistic-crypto-utils/"),
      packageDependencies: new Map([
        ["minimalistic-crypto-utils", "1.0.1"],
      ]),
    }],
  ])],
  ["parse-asn1", new Map([
    ["5.1.5", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-parse-asn1-5.1.5-003271343da58dc94cace494faef3d2147ecea0e/node_modules/parse-asn1/"),
      packageDependencies: new Map([
        ["asn1.js", "4.10.1"],
        ["browserify-aes", "1.2.0"],
        ["create-hash", "1.2.0"],
        ["evp_bytestokey", "1.0.3"],
        ["pbkdf2", "3.0.17"],
        ["safe-buffer", "5.2.0"],
        ["parse-asn1", "5.1.5"],
      ]),
    }],
  ])],
  ["asn1.js", new Map([
    ["4.10.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-asn1-js-4.10.1-b9c2bf5805f1e64aadeed6df3a2bfafb5a73f5a0/node_modules/asn1.js/"),
      packageDependencies: new Map([
        ["bn.js", "4.11.8"],
        ["inherits", "2.0.4"],
        ["minimalistic-assert", "1.0.1"],
        ["asn1.js", "4.10.1"],
      ]),
    }],
  ])],
  ["pbkdf2", new Map([
    ["3.0.17", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-pbkdf2-3.0.17-976c206530617b14ebb32114239f7b09336e93a6/node_modules/pbkdf2/"),
      packageDependencies: new Map([
        ["create-hash", "1.2.0"],
        ["create-hmac", "1.1.7"],
        ["ripemd160", "2.0.2"],
        ["safe-buffer", "5.2.0"],
        ["sha.js", "2.4.11"],
        ["pbkdf2", "3.0.17"],
      ]),
    }],
  ])],
  ["create-ecdh", new Map([
    ["4.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-create-ecdh-4.0.3-c9111b6f33045c4697f144787f9254cdc77c45ff/node_modules/create-ecdh/"),
      packageDependencies: new Map([
        ["bn.js", "4.11.8"],
        ["elliptic", "6.5.1"],
        ["create-ecdh", "4.0.3"],
      ]),
    }],
  ])],
  ["diffie-hellman", new Map([
    ["5.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-diffie-hellman-5.0.3-40e8ee98f55a2149607146921c63e1ae5f3d2875/node_modules/diffie-hellman/"),
      packageDependencies: new Map([
        ["bn.js", "4.11.8"],
        ["miller-rabin", "4.0.1"],
        ["randombytes", "2.1.0"],
        ["diffie-hellman", "5.0.3"],
      ]),
    }],
  ])],
  ["miller-rabin", new Map([
    ["4.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-miller-rabin-4.0.1-f080351c865b0dc562a8462966daa53543c78a4d/node_modules/miller-rabin/"),
      packageDependencies: new Map([
        ["bn.js", "4.11.8"],
        ["brorand", "1.1.0"],
        ["miller-rabin", "4.0.1"],
      ]),
    }],
  ])],
  ["public-encrypt", new Map([
    ["4.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-public-encrypt-4.0.3-4fcc9d77a07e48ba7527e7cbe0de33d0701331e0/node_modules/public-encrypt/"),
      packageDependencies: new Map([
        ["bn.js", "4.11.8"],
        ["browserify-rsa", "4.0.1"],
        ["create-hash", "1.2.0"],
        ["parse-asn1", "5.1.5"],
        ["randombytes", "2.1.0"],
        ["safe-buffer", "5.2.0"],
        ["public-encrypt", "4.0.3"],
      ]),
    }],
  ])],
  ["randomfill", new Map([
    ["1.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-randomfill-1.0.4-c92196fc86ab42be983f1bf31778224931d61458/node_modules/randomfill/"),
      packageDependencies: new Map([
        ["randombytes", "2.1.0"],
        ["safe-buffer", "5.2.0"],
        ["randomfill", "1.0.4"],
      ]),
    }],
  ])],
  ["deps-sort", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-deps-sort-2.0.0-091724902e84658260eb910748cccd1af6e21fb5/node_modules/deps-sort/"),
      packageDependencies: new Map([
        ["JSONStream", "1.3.5"],
        ["shasum", "1.0.2"],
        ["subarg", "1.0.0"],
        ["through2", "2.0.5"],
        ["deps-sort", "2.0.0"],
      ]),
    }],
  ])],
  ["shasum", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-shasum-1.0.2-e7012310d8f417f4deb5712150e5678b87ae565f/node_modules/shasum/"),
      packageDependencies: new Map([
        ["json-stable-stringify", "0.0.1"],
        ["sha.js", "2.4.11"],
        ["shasum", "1.0.2"],
      ]),
    }],
  ])],
  ["json-stable-stringify", new Map([
    ["0.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-json-stable-stringify-0.0.1-611c23e814db375527df851193db59dd2af27f45/node_modules/json-stable-stringify/"),
      packageDependencies: new Map([
        ["jsonify", "0.0.0"],
        ["json-stable-stringify", "0.0.1"],
      ]),
    }],
  ])],
  ["subarg", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-subarg-1.0.0-f62cf17581e996b48fc965699f54c06ae268b8d2/node_modules/subarg/"),
      packageDependencies: new Map([
        ["minimist", "1.2.0"],
        ["subarg", "1.0.0"],
      ]),
    }],
  ])],
  ["domain-browser", new Map([
    ["1.1.7", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-domain-browser-1.1.7-867aa4b093faa05f1de08c06f4d7b21fdf8698bc/node_modules/domain-browser/"),
      packageDependencies: new Map([
        ["domain-browser", "1.1.7"],
      ]),
    }],
  ])],
  ["duplexer2", new Map([
    ["0.1.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-duplexer2-0.1.4-8b12dab878c0d69e3e7891051662a32fc6bddcc1/node_modules/duplexer2/"),
      packageDependencies: new Map([
        ["readable-stream", "2.3.6"],
        ["duplexer2", "0.1.4"],
      ]),
    }],
  ])],
  ["events", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-events-1.1.1-9ebdb7635ad099c70dcc4c2a1f5004288e8bd924/node_modules/events/"),
      packageDependencies: new Map([
        ["events", "1.1.1"],
      ]),
    }],
  ])],
  ["has", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-has-1.0.3-722d7cbfc1f6aa8241f16dd814e011e1f41e8796/node_modules/has/"),
      packageDependencies: new Map([
        ["function-bind", "1.1.1"],
        ["has", "1.0.3"],
      ]),
    }],
  ])],
  ["function-bind", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-function-bind-1.1.1-a56899d3ea3c9bab874bb9773b7c5ede92f4895d/node_modules/function-bind/"),
      packageDependencies: new Map([
        ["function-bind", "1.1.1"],
      ]),
    }],
  ])],
  ["htmlescape", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-htmlescape-1.1.1-3a03edc2214bca3b66424a3e7959349509cb0351/node_modules/htmlescape/"),
      packageDependencies: new Map([
        ["htmlescape", "1.1.1"],
      ]),
    }],
  ])],
  ["https-browserify", new Map([
    ["0.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-https-browserify-0.0.1-3f91365cabe60b77ed0ebba24b454e3e09d95a82/node_modules/https-browserify/"),
      packageDependencies: new Map([
        ["https-browserify", "0.0.1"],
      ]),
    }],
  ])],
  ["insert-module-globals", new Map([
    ["7.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-insert-module-globals-7.2.0-ec87e5b42728479e327bd5c5c71611ddfb4752ba/node_modules/insert-module-globals/"),
      packageDependencies: new Map([
        ["JSONStream", "1.3.5"],
        ["acorn-node", "1.8.2"],
        ["combine-source-map", "0.8.0"],
        ["concat-stream", "1.6.2"],
        ["is-buffer", "1.1.6"],
        ["path-is-absolute", "1.0.1"],
        ["process", "0.11.10"],
        ["through2", "2.0.5"],
        ["undeclared-identifiers", "1.1.3"],
        ["xtend", "4.0.2"],
        ["insert-module-globals", "7.2.0"],
      ]),
    }],
  ])],
  ["acorn-node", new Map([
    ["1.8.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-acorn-node-1.8.2-114c95d64539e53dede23de8b9d96df7c7ae2af8/node_modules/acorn-node/"),
      packageDependencies: new Map([
        ["acorn", "7.1.0"],
        ["acorn-walk", "7.0.0"],
        ["xtend", "4.0.2"],
        ["acorn-node", "1.8.2"],
      ]),
    }],
  ])],
  ["acorn", new Map([
    ["7.1.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-acorn-7.1.0-949d36f2c292535da602283586c2477c57eb2d6c/node_modules/acorn/"),
      packageDependencies: new Map([
        ["acorn", "7.1.0"],
      ]),
    }],
    ["5.7.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-acorn-5.7.3-67aa231bf8812974b85235a96771eb6bd07ea279/node_modules/acorn/"),
      packageDependencies: new Map([
        ["acorn", "5.7.3"],
      ]),
    }],
  ])],
  ["acorn-walk", new Map([
    ["7.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-acorn-walk-7.0.0-c8ba6f0f1aac4b0a9e32d1f0af12be769528f36b/node_modules/acorn-walk/"),
      packageDependencies: new Map([
        ["acorn-walk", "7.0.0"],
      ]),
    }],
  ])],
  ["buffer-from", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-buffer-from-1.1.1-32713bc028f75c02fdb710d7c7bcec1f2c6070ef/node_modules/buffer-from/"),
      packageDependencies: new Map([
        ["buffer-from", "1.1.1"],
      ]),
    }],
  ])],
  ["process", new Map([
    ["0.11.10", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-process-0.11.10-7332300e840161bda3e69a1d1d91a7d4bc16f182/node_modules/process/"),
      packageDependencies: new Map([
        ["process", "0.11.10"],
      ]),
    }],
  ])],
  ["undeclared-identifiers", new Map([
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-undeclared-identifiers-1.1.3-9254c1d37bdac0ac2b52de4b6722792d2a91e30f/node_modules/undeclared-identifiers/"),
      packageDependencies: new Map([
        ["acorn-node", "1.8.2"],
        ["dash-ast", "1.0.0"],
        ["get-assigned-identifiers", "1.2.0"],
        ["simple-concat", "1.0.0"],
        ["xtend", "4.0.2"],
        ["undeclared-identifiers", "1.1.3"],
      ]),
    }],
  ])],
  ["dash-ast", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-dash-ast-1.0.0-12029ba5fb2f8aa6f0a861795b23c1b4b6c27d37/node_modules/dash-ast/"),
      packageDependencies: new Map([
        ["dash-ast", "1.0.0"],
      ]),
    }],
  ])],
  ["get-assigned-identifiers", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-get-assigned-identifiers-1.2.0-6dbf411de648cbaf8d9169ebb0d2d576191e2ff1/node_modules/get-assigned-identifiers/"),
      packageDependencies: new Map([
        ["get-assigned-identifiers", "1.2.0"],
      ]),
    }],
  ])],
  ["simple-concat", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-simple-concat-1.0.0-7344cbb8b6e26fb27d66b2fc86f9f6d5997521c6/node_modules/simple-concat/"),
      packageDependencies: new Map([
        ["simple-concat", "1.0.0"],
      ]),
    }],
  ])],
  ["labeled-stream-splicer", new Map([
    ["2.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-labeled-stream-splicer-2.0.2-42a41a16abcd46fd046306cf4f2c3576fffb1c21/node_modules/labeled-stream-splicer/"),
      packageDependencies: new Map([
        ["inherits", "2.0.4"],
        ["stream-splicer", "2.0.1"],
        ["labeled-stream-splicer", "2.0.2"],
      ]),
    }],
  ])],
  ["stream-splicer", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-stream-splicer-2.0.1-0b13b7ee2b5ac7e0609a7463d83899589a363fcd/node_modules/stream-splicer/"),
      packageDependencies: new Map([
        ["inherits", "2.0.4"],
        ["readable-stream", "2.3.6"],
        ["stream-splicer", "2.0.1"],
      ]),
    }],
  ])],
  ["module-deps", new Map([
    ["4.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-module-deps-4.1.1-23215833f1da13fd606ccb8087b44852dcb821fd/node_modules/module-deps/"),
      packageDependencies: new Map([
        ["JSONStream", "1.3.5"],
        ["browser-resolve", "1.11.3"],
        ["cached-path-relative", "1.0.2"],
        ["concat-stream", "1.5.2"],
        ["defined", "1.0.0"],
        ["detective", "4.7.1"],
        ["duplexer2", "0.1.4"],
        ["inherits", "2.0.4"],
        ["parents", "1.0.1"],
        ["readable-stream", "2.3.6"],
        ["resolve", "1.12.0"],
        ["stream-combiner2", "1.1.1"],
        ["subarg", "1.0.0"],
        ["through2", "2.0.5"],
        ["xtend", "4.0.2"],
        ["module-deps", "4.1.1"],
      ]),
    }],
  ])],
  ["detective", new Map([
    ["4.7.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-detective-4.7.1-0eca7314338442febb6d65da54c10bb1c82b246e/node_modules/detective/"),
      packageDependencies: new Map([
        ["acorn", "5.7.3"],
        ["defined", "1.0.0"],
        ["detective", "4.7.1"],
      ]),
    }],
  ])],
  ["parents", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-parents-1.0.1-fedd4d2bf193a77745fe71e371d73c3307d9c751/node_modules/parents/"),
      packageDependencies: new Map([
        ["path-platform", "0.11.15"],
        ["parents", "1.0.1"],
      ]),
    }],
  ])],
  ["path-platform", new Map([
    ["0.11.15", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-path-platform-0.11.15-e864217f74c36850f0852b78dc7bf7d4a5721bf2/node_modules/path-platform/"),
      packageDependencies: new Map([
        ["path-platform", "0.11.15"],
      ]),
    }],
  ])],
  ["stream-combiner2", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-stream-combiner2-1.1.1-fb4d8a1420ea362764e21ad4780397bebcb41cbe/node_modules/stream-combiner2/"),
      packageDependencies: new Map([
        ["duplexer2", "0.1.4"],
        ["readable-stream", "2.3.6"],
        ["stream-combiner2", "1.1.1"],
      ]),
    }],
  ])],
  ["os-browserify", new Map([
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-os-browserify-0.1.2-49ca0293e0b19590a5f5de10c7f265a617d8fe54/node_modules/os-browserify/"),
      packageDependencies: new Map([
        ["os-browserify", "0.1.2"],
      ]),
    }],
  ])],
  ["path-browserify", new Map([
    ["0.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-path-browserify-0.0.1-e6c4ddd7ed3aa27c68a20cc4e50e1a4ee83bbc4a/node_modules/path-browserify/"),
      packageDependencies: new Map([
        ["path-browserify", "0.0.1"],
      ]),
    }],
  ])],
  ["querystring-es3", new Map([
    ["0.2.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-querystring-es3-0.2.1-9ec61f79049875707d69414596fd907a4d711e73/node_modules/querystring-es3/"),
      packageDependencies: new Map([
        ["querystring-es3", "0.2.1"],
      ]),
    }],
  ])],
  ["read-only-stream", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-read-only-stream-2.0.0-2724fd6a8113d73764ac288d4386270c1dbf17f0/node_modules/read-only-stream/"),
      packageDependencies: new Map([
        ["readable-stream", "2.3.6"],
        ["read-only-stream", "2.0.0"],
      ]),
    }],
  ])],
  ["shell-quote", new Map([
    ["1.7.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-shell-quote-1.7.2-67a7d02c76c9da24f99d20808fcaded0e0e04be2/node_modules/shell-quote/"),
      packageDependencies: new Map([
        ["shell-quote", "1.7.2"],
      ]),
    }],
  ])],
  ["stream-browserify", new Map([
    ["2.0.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-stream-browserify-2.0.2-87521d38a44aa7ee91ce1cd2a47df0cb49dd660b/node_modules/stream-browserify/"),
      packageDependencies: new Map([
        ["inherits", "2.0.4"],
        ["readable-stream", "2.3.6"],
        ["stream-browserify", "2.0.2"],
      ]),
    }],
  ])],
  ["stream-http", new Map([
    ["2.8.3", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-stream-http-2.8.3-b2d242469288a5a27ec4fe8933acf623de6514fc/node_modules/stream-http/"),
      packageDependencies: new Map([
        ["builtin-status-codes", "3.0.0"],
        ["inherits", "2.0.4"],
        ["readable-stream", "2.3.6"],
        ["to-arraybuffer", "1.0.1"],
        ["xtend", "4.0.2"],
        ["stream-http", "2.8.3"],
      ]),
    }],
  ])],
  ["builtin-status-codes", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-builtin-status-codes-3.0.0-85982878e21b98e1c66425e03d0174788f569ee8/node_modules/builtin-status-codes/"),
      packageDependencies: new Map([
        ["builtin-status-codes", "3.0.0"],
      ]),
    }],
  ])],
  ["to-arraybuffer", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-to-arraybuffer-1.0.1-7d229b1fcc637e466ca081180836a7aabff83f43/node_modules/to-arraybuffer/"),
      packageDependencies: new Map([
        ["to-arraybuffer", "1.0.1"],
      ]),
    }],
  ])],
  ["syntax-error", new Map([
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-syntax-error-1.4.0-2d9d4ff5c064acb711594a3e3b95054ad51d907c/node_modules/syntax-error/"),
      packageDependencies: new Map([
        ["acorn-node", "1.8.2"],
        ["syntax-error", "1.4.0"],
      ]),
    }],
  ])],
  ["timers-browserify", new Map([
    ["1.4.2", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-timers-browserify-1.4.2-c9c58b575be8407375cb5e2462dacee74359f41d/node_modules/timers-browserify/"),
      packageDependencies: new Map([
        ["process", "0.11.10"],
        ["timers-browserify", "1.4.2"],
      ]),
    }],
  ])],
  ["tty-browserify", new Map([
    ["0.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-tty-browserify-0.0.1-3f05251ee17904dfd0677546670db9651682b811/node_modules/tty-browserify/"),
      packageDependencies: new Map([
        ["tty-browserify", "0.0.1"],
      ]),
    }],
  ])],
  ["url", new Map([
    ["0.11.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-url-0.11.0-3838e97cfc60521eb73c525a8e55bfdd9e2e28f1/node_modules/url/"),
      packageDependencies: new Map([
        ["punycode", "1.3.2"],
        ["querystring", "0.2.0"],
        ["url", "0.11.0"],
      ]),
    }],
  ])],
  ["querystring", new Map([
    ["0.2.0", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-querystring-0.2.0-b209849203bb25df820da756e747005878521620/node_modules/querystring/"),
      packageDependencies: new Map([
        ["querystring", "0.2.0"],
      ]),
    }],
  ])],
  ["vm-browserify", new Map([
    ["0.0.4", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-vm-browserify-0.0.4-5d7ea45bbef9e4a6ff65f95438e0a87c357d5a73/node_modules/vm-browserify/"),
      packageDependencies: new Map([
        ["indexof", "0.0.1"],
        ["vm-browserify", "0.0.4"],
      ]),
    }],
  ])],
  ["indexof", new Map([
    ["0.0.1", {
      packageLocation: path.resolve(__dirname, "../../Library/Caches/Yarn/v4/npm-indexof-0.0.1-82dc336d232b9062179d05ab3293a66059fd435d/node_modules/indexof/"),
      packageDependencies: new Map([
        ["indexof", "0.0.1"],
      ]),
    }],
  ])],
  [null, new Map([
    [null, {
      packageLocation: path.resolve(__dirname, "./"),
      packageDependencies: new Map([
        ["body-parser", "1.9.0"],
        ["cookie-parser", "1.3.3"],
        ["ejs", "1.0.0"],
        ["ejs-locals", "1.0.2"],
        ["errorhandler", "1.2.0"],
        ["express", "4.12.4"],
        ["express-fileupload", "0.0.5"],
        ["humanize-ms", "1.0.1"],
        ["jquery", "2.2.4"],
        ["marked", "0.3.5"],
        ["method-override", "3.0.0"],
        ["moment", "2.15.1"],
        ["mongoose", "4.2.4"],
        ["morgan", "1.9.1"],
        ["ms", "0.7.3"],
        ["npmconf", "0.0.24"],
        ["optional", "0.1.4"],
        ["st", "0.2.4"],
        ["stream-buffers", "3.0.2"],
        ["tap", "5.8.0"],
        ["browserify", "13.3.0"],
      ]),
    }],
  ])],
]);

let locatorsByLocations = new Map([
  ["../../Library/Caches/Yarn/v4/npm-body-parser-1.9.0-95d72943b1a4f67f56bbac9e0dcc837b68703605/node_modules/body-parser/", {"name":"body-parser","reference":"1.9.0"}],
  ["../../Library/Caches/Yarn/v4/npm-bytes-1.0.0-3569ede8ba34315fab99c3e92cb04c7220de1fa8/node_modules/bytes/", {"name":"bytes","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-depd-1.0.1-80aec64c9d6d97e65cc2a9caa93c0aa6abf73aaa/node_modules/depd/", {"name":"depd","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-depd-1.1.2-9bcd52e14c097763e749b274c4346ed2e560b5a9/node_modules/depd/", {"name":"depd","reference":"1.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-iconv-lite-0.4.4-e95f2e41db0735fc21652f7827a5ee32e63c83a8/node_modules/iconv-lite/", {"name":"iconv-lite","reference":"0.4.4"}],
  ["../../Library/Caches/Yarn/v4/npm-media-typer-0.3.0-8710d7af0aa626f8fffa1ce00168545263255748/node_modules/media-typer/", {"name":"media-typer","reference":"0.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-on-finished-2.1.0-0c539f09291e8ffadde0c8a25850fb2cedc7022d/node_modules/on-finished/", {"name":"on-finished","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-on-finished-2.2.1-5c85c1cc36299f78029653f667f27b6b99ebc029/node_modules/on-finished/", {"name":"on-finished","reference":"2.2.1"}],
  ["../../Library/Caches/Yarn/v4/npm-on-finished-2.3.0-20f1336481b083cd75337992a16971aa2d906947/node_modules/on-finished/", {"name":"on-finished","reference":"2.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-ee-first-1.0.5-8c9b212898d8cd9f1a9436650ce7be202c9e9ff0/node_modules/ee-first/", {"name":"ee-first","reference":"1.0.5"}],
  ["../../Library/Caches/Yarn/v4/npm-ee-first-1.1.0-6a0d7c6221e490feefd92ec3f441c9ce8cd097f4/node_modules/ee-first/", {"name":"ee-first","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-ee-first-1.1.1-590c61156b0ae2f4f0255732a158b266bc56b21d/node_modules/ee-first/", {"name":"ee-first","reference":"1.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-qs-2.2.4-2e9fbcd34b540e3421c924ecd01e90aa975319c8/node_modules/qs/", {"name":"qs","reference":"2.2.4"}],
  ["../../Library/Caches/Yarn/v4/npm-qs-2.4.2-f7ce788e5777df0b5010da7f7c4e73ba32470f5a/node_modules/qs/", {"name":"qs","reference":"2.4.2"}],
  ["../../Library/Caches/Yarn/v4/npm-qs-1.2.2-19b57ff24dc2a99ce1f8bdf6afcda59f8ef61f88/node_modules/qs/", {"name":"qs","reference":"1.2.2"}],
  ["../../Library/Caches/Yarn/v4/npm-qs-6.3.2-e75bd5f6e268122a2a0e0bda630b2550c166502c/node_modules/qs/", {"name":"qs","reference":"6.3.2"}],
  ["../../Library/Caches/Yarn/v4/npm-raw-body-1.3.0-978230a156a5548f42eef14de22d0f4f610083d1/node_modules/raw-body/", {"name":"raw-body","reference":"1.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-type-is-1.5.7-b9368a593cc6ef7d0645e78b2f4c64cbecd05e90/node_modules/type-is/", {"name":"type-is","reference":"1.5.7"}],
  ["../../Library/Caches/Yarn/v4/npm-type-is-1.6.18-4e552cd05df09467dcbc4ef739de89f2cf37c131/node_modules/type-is/", {"name":"type-is","reference":"1.6.18"}],
  ["../../Library/Caches/Yarn/v4/npm-mime-types-2.0.14-310e159db23e077f8bb22b748dabfa4957140aa6/node_modules/mime-types/", {"name":"mime-types","reference":"2.0.14"}],
  ["../../Library/Caches/Yarn/v4/npm-mime-types-2.1.24-b6f8d0b3e951efb77dedeca194cff6d16f676f81/node_modules/mime-types/", {"name":"mime-types","reference":"2.1.24"}],
  ["../../Library/Caches/Yarn/v4/npm-mime-types-1.0.2-995ae1392ab8affcbfcb2641dd054e943c0d5dce/node_modules/mime-types/", {"name":"mime-types","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-mime-db-1.12.0-3d0c63180f458eb10d325aaa37d7c58ae312e9d7/node_modules/mime-db/", {"name":"mime-db","reference":"1.12.0"}],
  ["../../Library/Caches/Yarn/v4/npm-mime-db-1.40.0-a65057e998db090f732a68f6c276d387d4126c32/node_modules/mime-db/", {"name":"mime-db","reference":"1.40.0"}],
  ["../../Library/Caches/Yarn/v4/npm-cookie-parser-1.3.3-7e3a2c745f4b460d5a340e578a0baa5d7725fe37/node_modules/cookie-parser/", {"name":"cookie-parser","reference":"1.3.3"}],
  ["../../Library/Caches/Yarn/v4/npm-cookie-0.1.2-72fec3d24e48a3432073d90c12642005061004b1/node_modules/cookie/", {"name":"cookie","reference":"0.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-cookie-signature-1.0.5-a122e3f1503eca0f5355795b0711bb2368d450f9/node_modules/cookie-signature/", {"name":"cookie-signature","reference":"1.0.5"}],
  ["../../Library/Caches/Yarn/v4/npm-cookie-signature-1.0.6-e303a882b342cc3ee8ca513a79999734dab3ae2c/node_modules/cookie-signature/", {"name":"cookie-signature","reference":"1.0.6"}],
  ["../../Library/Caches/Yarn/v4/npm-ejs-1.0.0-c9c60a48a46ee452fb32a71c317b95e5aa1fcb3d/node_modules/ejs/", {"name":"ejs","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-ejs-0.8.8-ffdc56dcc35d02926dd50ad13439bbc54061d598/node_modules/ejs/", {"name":"ejs","reference":"0.8.8"}],
  ["../../Library/Caches/Yarn/v4/npm-ejs-locals-1.0.2-b9b320ff6933154105fa0eed683ea64d678088ce/node_modules/ejs-locals/", {"name":"ejs-locals","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-errorhandler-1.2.0-2f89db72c150580c65e8dd5180504f5b8a398bd9/node_modules/errorhandler/", {"name":"errorhandler","reference":"1.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-accepts-1.1.4-d71c96f7d41d0feda2c38cd14e8a27c04158df4a/node_modules/accepts/", {"name":"accepts","reference":"1.1.4"}],
  ["../../Library/Caches/Yarn/v4/npm-accepts-1.2.13-e5f1f3928c6d95fd96558c36ec3d9d0de4a6ecea/node_modules/accepts/", {"name":"accepts","reference":"1.2.13"}],
  ["../../Library/Caches/Yarn/v4/npm-negotiator-0.4.9-92e46b6db53c7e421ed64a2bc94f08be7630df3f/node_modules/negotiator/", {"name":"negotiator","reference":"0.4.9"}],
  ["../../Library/Caches/Yarn/v4/npm-negotiator-0.5.3-269d5c476810ec92edbe7b6c2f28316384f9a7e8/node_modules/negotiator/", {"name":"negotiator","reference":"0.5.3"}],
  ["../../Library/Caches/Yarn/v4/npm-negotiator-0.2.8-adfd207a3875c4d37095729c2e7c283c5ba2ee72/node_modules/negotiator/", {"name":"negotiator","reference":"0.2.8"}],
  ["../../Library/Caches/Yarn/v4/npm-escape-html-1.0.1-181a286ead397a39a92857cfb1d43052e356bff0/node_modules/escape-html/", {"name":"escape-html","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-express-4.12.4-8fec2510255bc6b2e58107c48239c0fa307c1aa2/node_modules/express/", {"name":"express","reference":"4.12.4"}],
  ["../../Library/Caches/Yarn/v4/npm-content-disposition-0.5.0-4284fe6ae0630874639e44e80a418c2934135e9e/node_modules/content-disposition/", {"name":"content-disposition","reference":"0.5.0"}],
  ["../../Library/Caches/Yarn/v4/npm-content-type-1.0.4-e138cc75e040c727b1966fe5e5f8c9aee256fe3b/node_modules/content-type/", {"name":"content-type","reference":"1.0.4"}],
  ["../../Library/Caches/Yarn/v4/npm-debug-2.2.0-f87057e995b1a1f6ae6a4960664137bc56f039da/node_modules/debug/", {"name":"debug","reference":"2.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-debug-3.1.0-5bb5a0672628b64149566ba16819e61518c67261/node_modules/debug/", {"name":"debug","reference":"3.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-debug-2.6.9-5d128515df134ff327e90a4c93f4e077a536341f/node_modules/debug/", {"name":"debug","reference":"2.6.9"}],
  ["../../Library/Caches/Yarn/v4/npm-ms-0.7.1-9cd13c03adbff25b65effde7ce864ee952017098/node_modules/ms/", {"name":"ms","reference":"0.7.1"}],
  ["../../Library/Caches/Yarn/v4/npm-ms-0.6.2-d89c2124c6fdc1353d65a8b77bf1aac4b193708c/node_modules/ms/", {"name":"ms","reference":"0.6.2"}],
  ["../../Library/Caches/Yarn/v4/npm-ms-2.0.0-5608aeadfc00be6c2901df5f9861788de0d597c8/node_modules/ms/", {"name":"ms","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-ms-0.7.3-708155a5e44e33f5fd0fc53e81d0d40a91be1fff/node_modules/ms/", {"name":"ms","reference":"0.7.3"}],
  ["../../Library/Caches/Yarn/v4/npm-etag-1.6.0-8bcb2c6af1254c481dfc8b997c906ef4e442c207/node_modules/etag/", {"name":"etag","reference":"1.6.0"}],
  ["../../Library/Caches/Yarn/v4/npm-crc-3.2.1-5d9c8fb77a245cd5eca291e5d2d005334bab0082/node_modules/crc/", {"name":"crc","reference":"3.2.1"}],
  ["../../Library/Caches/Yarn/v4/npm-finalhandler-0.3.6-daf9c4161b1b06e001466b1411dfdb6973be138b/node_modules/finalhandler/", {"name":"finalhandler","reference":"0.3.6"}],
  ["../../Library/Caches/Yarn/v4/npm-fresh-0.2.4-3582499206c9723714190edd74b4604feb4a614c/node_modules/fresh/", {"name":"fresh","reference":"0.2.4"}],
  ["../../Library/Caches/Yarn/v4/npm-merge-descriptors-1.0.0-2169cf7538e1b0cc87fb88e1502d8474bbf79864/node_modules/merge-descriptors/", {"name":"merge-descriptors","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-methods-1.1.2-5529a4d67654134edcc5266656835b0f851afcee/node_modules/methods/", {"name":"methods","reference":"1.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-parseurl-1.3.3-9da19e7bee8d12dff0513ed5b76957793bc2e8d4/node_modules/parseurl/", {"name":"parseurl","reference":"1.3.3"}],
  ["../../Library/Caches/Yarn/v4/npm-path-to-regexp-0.1.3-21b9ab82274279de25b156ea08fd12ca51b8aecb/node_modules/path-to-regexp/", {"name":"path-to-regexp","reference":"0.1.3"}],
  ["../../Library/Caches/Yarn/v4/npm-proxy-addr-1.0.10-0d40a82f801fc355567d2ecb65efe3f077f121c5/node_modules/proxy-addr/", {"name":"proxy-addr","reference":"1.0.10"}],
  ["../../Library/Caches/Yarn/v4/npm-forwarded-0.1.2-98c23dab1175657b8c0573e8ceccd91b0ff18c84/node_modules/forwarded/", {"name":"forwarded","reference":"0.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-ipaddr-js-1.0.5-5fa78cf301b825c78abc3042d812723049ea23c7/node_modules/ipaddr.js/", {"name":"ipaddr.js","reference":"1.0.5"}],
  ["../../Library/Caches/Yarn/v4/npm-range-parser-1.0.3-6872823535c692e2c2a0103826afd82c2e0ff175/node_modules/range-parser/", {"name":"range-parser","reference":"1.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-send-0.12.3-cd12dc58fde21e4f91902b39b2fda05a7a6d9bdc/node_modules/send/", {"name":"send","reference":"0.12.3"}],
  ["../../Library/Caches/Yarn/v4/npm-destroy-1.0.3-b433b4724e71fd8551d9885174851c5fc377e2c9/node_modules/destroy/", {"name":"destroy","reference":"1.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-mime-1.3.4-115f9e3b6b3daf2959983cb38f149a2d40eb5d53/node_modules/mime/", {"name":"mime","reference":"1.3.4"}],
  ["../../Library/Caches/Yarn/v4/npm-mime-1.2.11-58203eed86e3a5ef17aed2b7d9ebd47f0a60dd10/node_modules/mime/", {"name":"mime","reference":"1.2.11"}],
  ["../../Library/Caches/Yarn/v4/npm-serve-static-1.9.3-5f8da07323ad385ff3dc541f1a7917b2e436eb57/node_modules/serve-static/", {"name":"serve-static","reference":"1.9.3"}],
  ["../../Library/Caches/Yarn/v4/npm-utils-merge-1.0.0-0294fb922bb9375153541c4f7096231f287c8af8/node_modules/utils-merge/", {"name":"utils-merge","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-vary-1.0.1-99e4981566a286118dfb2b817357df7993376d10/node_modules/vary/", {"name":"vary","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-vary-1.1.2-2299f02c6ded30d4a5961b0b9f74524a18f634fc/node_modules/vary/", {"name":"vary","reference":"1.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-express-fileupload-0.0.5-433a712525afa98b4c93162522e8bf79c68d82e7/node_modules/express-fileupload/", {"name":"express-fileupload","reference":"0.0.5"}],
  ["../../Library/Caches/Yarn/v4/npm-connect-busboy-0.0.2-ac5c9c96672171885e576c66b2bfd95d3bb11097/node_modules/connect-busboy/", {"name":"connect-busboy","reference":"0.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-busboy-0.3.1-170899274c5bf38aae27d5c62b71268cd585fd1b/node_modules/busboy/", {"name":"busboy","reference":"0.3.1"}],
  ["../../Library/Caches/Yarn/v4/npm-dicer-0.3.0-eacd98b3bfbf92e8ab5c2fdb71aaac44bb06b872/node_modules/dicer/", {"name":"dicer","reference":"0.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-streamsearch-0.1.2-808b9d0e56fc273d809ba57338e929919a1a9f1a/node_modules/streamsearch/", {"name":"streamsearch","reference":"0.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-fs-extra-0.22.1-5fd6f8049dc976ca19eb2355d658173cabcce056/node_modules/fs-extra/", {"name":"fs-extra","reference":"0.22.1"}],
  ["../../Library/Caches/Yarn/v4/npm-graceful-fs-4.2.2-6f0952605d0140c1cfdb138ed005775b92d67b02/node_modules/graceful-fs/", {"name":"graceful-fs","reference":"4.2.2"}],
  ["../../Library/Caches/Yarn/v4/npm-graceful-fs-1.2.3-15a4806a57547cb2d2dbf27f42e89a8c3451b364/node_modules/graceful-fs/", {"name":"graceful-fs","reference":"1.2.3"}],
  ["../../Library/Caches/Yarn/v4/npm-jsonfile-2.4.0-3736a2b428b87bbda0cc83b53fa3d633a35c2ae8/node_modules/jsonfile/", {"name":"jsonfile","reference":"2.4.0"}],
  ["../../Library/Caches/Yarn/v4/npm-rimraf-2.7.1-35797f13a7fdadc566142c29d4f07ccad483e3ec/node_modules/rimraf/", {"name":"rimraf","reference":"2.7.1"}],
  ["../../Library/Caches/Yarn/v4/npm-glob-7.1.4-aa608a2f6c577ad357e1ae5a5c26d9a8d1969255/node_modules/glob/", {"name":"glob","reference":"7.1.4"}],
  ["../../Library/Caches/Yarn/v4/npm-glob-5.0.15-1bc936b9e02f4a603fcc222ecf7633d30b8b93b1/node_modules/glob/", {"name":"glob","reference":"5.0.15"}],
  ["../../Library/Caches/Yarn/v4/npm-fs-realpath-1.0.0-1504ad2523158caa40db4a2787cb01411994ea4f/node_modules/fs.realpath/", {"name":"fs.realpath","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-inflight-1.0.6-49bd6331d7d02d0c09bc910a1075ba8165b56df9/node_modules/inflight/", {"name":"inflight","reference":"1.0.6"}],
  ["../../Library/Caches/Yarn/v4/npm-once-1.4.0-583b1aa775961d4b113ac17d9c50baef9dd76bd1/node_modules/once/", {"name":"once","reference":"1.4.0"}],
  ["../../Library/Caches/Yarn/v4/npm-once-1.1.1-9db574933ccb08c3a7614d154032c09ea6f339e7/node_modules/once/", {"name":"once","reference":"1.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-wrappy-1.0.2-b5243d8f3ec1aa35f1364605bc0d1036e30ab69f/node_modules/wrappy/", {"name":"wrappy","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-inherits-2.0.4-0fa2c64f932917c3433a0ded55363aae37416b7c/node_modules/inherits/", {"name":"inherits","reference":"2.0.4"}],
  ["../../Library/Caches/Yarn/v4/npm-inherits-1.0.2-ca4309dadee6b54cc0b8d247e8d7c7a0975bdc9b/node_modules/inherits/", {"name":"inherits","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-inherits-2.0.1-b17d08d326b4423e568eff719f91b0b1cbdf69f1/node_modules/inherits/", {"name":"inherits","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-inherits-2.0.3-633c2c83e3da42a502f52466022480f4208261de/node_modules/inherits/", {"name":"inherits","reference":"2.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-minimatch-3.0.4-5166e286457f03306064be5497e8dbb0c3d32083/node_modules/minimatch/", {"name":"minimatch","reference":"3.0.4"}],
  ["../../Library/Caches/Yarn/v4/npm-brace-expansion-1.1.11-3c7fcbf529d87226f3d2f52b966ff5271eb441dd/node_modules/brace-expansion/", {"name":"brace-expansion","reference":"1.1.11"}],
  ["../../Library/Caches/Yarn/v4/npm-balanced-match-1.0.0-89b4d199ab2bee49de164ea02b89ce462d71b767/node_modules/balanced-match/", {"name":"balanced-match","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-concat-map-0.0.1-d8a96bd77fd68df7793a73036a3ba0d5405d477b/node_modules/concat-map/", {"name":"concat-map","reference":"0.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-path-is-absolute-1.0.1-174b9268735534ffbc7ace6bf53a5a9e1b5c5f5f/node_modules/path-is-absolute/", {"name":"path-is-absolute","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-streamifier-0.1.1-97e98d8fa4d105d62a2691d1dc07e820db8dfc4f/node_modules/streamifier/", {"name":"streamifier","reference":"0.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-humanize-ms-1.0.1-4336d3c4392236bb8e59cda599f6d88675dc5ff8/node_modules/humanize-ms/", {"name":"humanize-ms","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-jquery-2.2.4-2c89d6889b5eac522a7eea32c14521559c6cbf02/node_modules/jquery/", {"name":"jquery","reference":"2.2.4"}],
  ["../../Library/Caches/Yarn/v4/npm-marked-0.3.5-4113a15ac5d7bca158a5aae07224587b9fa15b94/node_modules/marked/", {"name":"marked","reference":"0.3.5"}],
  ["../../Library/Caches/Yarn/v4/npm-method-override-3.0.0-6ab0d5d574e3208f15b0c9cf45ab52000468d7a2/node_modules/method-override/", {"name":"method-override","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-moment-2.15.1-e979c2a29e22888e60f396f2220a6118f85cd94c/node_modules/moment/", {"name":"moment","reference":"2.15.1"}],
  ["../../Library/Caches/Yarn/v4/npm-mongoose-4.2.4-e2f8c007dd838f6633b4f6c965ba92a232ac9317/node_modules/mongoose/", {"name":"mongoose","reference":"4.2.4"}],
  ["../../Library/Caches/Yarn/v4/npm-async-0.9.0-ac3613b1da9bed1b47510bb4651b8931e47146c7/node_modules/async/", {"name":"async","reference":"0.9.0"}],
  ["../../Library/Caches/Yarn/v4/npm-async-0.9.2-aea74d5e61c1f899613bf64bda66d4c78f2fd17d/node_modules/async/", {"name":"async","reference":"0.9.2"}],
  ["../../Library/Caches/Yarn/v4/npm-async-1.5.2-ec6a61ae56480c0c3cb241c95618e20892f9672a/node_modules/async/", {"name":"async","reference":"1.5.2"}],
  ["../../Library/Caches/Yarn/v4/npm-bson-0.4.23-e65a2e3c7507ffade4109bc7575a76e50f8da915/node_modules/bson/", {"name":"bson","reference":"0.4.23"}],
  ["../../Library/Caches/Yarn/v4/npm-hooks-fixed-1.1.0-0e8c15336708e6611185fe390b44687dd5230dbb/node_modules/hooks-fixed/", {"name":"hooks-fixed","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-kareem-1.0.1-7805d215bb53214ec3af969a1d0b1f17e3e7b95c/node_modules/kareem/", {"name":"kareem","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-mongodb-2.0.46-b1b857465e45e259b1e0e033698341a64cb93559/node_modules/mongodb/", {"name":"mongodb","reference":"2.0.46"}],
  ["../../Library/Caches/Yarn/v4/npm-es6-promise-2.1.1-03e8f3c7297928e5478d6ab1d0643251507bdedd/node_modules/es6-promise/", {"name":"es6-promise","reference":"2.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-mongodb-core-1.2.19-fcb35f6b6abc5c3de1f1a4a5db526b9e306f3eb7/node_modules/mongodb-core/", {"name":"mongodb-core","reference":"1.2.19"}],
  ["./.pnp/unplugged/npm-kerberos-0.0.24-67e5fe0f0dbe240a505eb45de411d6031e7b381b/node_modules/kerberos/", {"name":"kerberos","reference":"0.0.24"}],
  ["../../Library/Caches/Yarn/v4/npm-nan-2.10.0-96d0cd610ebd58d4b4de9cc0c6828cda99c7548f/node_modules/nan/", {"name":"nan","reference":"2.10.0"}],
  ["../../Library/Caches/Yarn/v4/npm-readable-stream-1.0.31-8f2502e0bc9e3b0da1b94520aabb4e2603ecafae/node_modules/readable-stream/", {"name":"readable-stream","reference":"1.0.31"}],
  ["../../Library/Caches/Yarn/v4/npm-readable-stream-1.0.34-125820e34bc842d2f2aaafafe4c2916ee32c157c/node_modules/readable-stream/", {"name":"readable-stream","reference":"1.0.34"}],
  ["../../Library/Caches/Yarn/v4/npm-readable-stream-2.3.6-b11c27d88b8ff1fbe070643cf94b0c79ae1b0aaf/node_modules/readable-stream/", {"name":"readable-stream","reference":"2.3.6"}],
  ["../../Library/Caches/Yarn/v4/npm-readable-stream-1.1.14-7cf4c54ef648e3813084c636dd2079e166c081d9/node_modules/readable-stream/", {"name":"readable-stream","reference":"1.1.14"}],
  ["../../Library/Caches/Yarn/v4/npm-readable-stream-2.0.6-8f90341e68a53ccc928788dacfcd11b36eb9b78e/node_modules/readable-stream/", {"name":"readable-stream","reference":"2.0.6"}],
  ["../../Library/Caches/Yarn/v4/npm-core-util-is-1.0.2-b5fd54220aa2bc5ab57aab7140c940754503c1a7/node_modules/core-util-is/", {"name":"core-util-is","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-isarray-0.0.1-8a18acfca9a8f4177e09abfc6038939b05d1eedf/node_modules/isarray/", {"name":"isarray","reference":"0.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-isarray-1.0.0-bb935d48582cba168c06834957a54a3e07124f11/node_modules/isarray/", {"name":"isarray","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-string-decoder-0.10.31-62e203bc41766c6c28c9fc84301dab1c5310fa94/node_modules/string_decoder/", {"name":"string_decoder","reference":"0.10.31"}],
  ["../../Library/Caches/Yarn/v4/npm-string-decoder-1.1.1-9cf1611ba62685d7030ae9e4ba34149c3af03fc8/node_modules/string_decoder/", {"name":"string_decoder","reference":"1.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-mpath-0.1.1-23da852b7c232ee097f4759d29c0ee9cd22d5e46/node_modules/mpath/", {"name":"mpath","reference":"0.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-mpromise-0.5.4-b610613ec6de37419f944b35f0783b4de9f5dc75/node_modules/mpromise/", {"name":"mpromise","reference":"0.5.4"}],
  ["../../Library/Caches/Yarn/v4/npm-mquery-1.6.3-7c02bfb7e49c8012cece1556c5e65fef61f3c8e5/node_modules/mquery/", {"name":"mquery","reference":"1.6.3"}],
  ["../../Library/Caches/Yarn/v4/npm-bluebird-2.9.26-362772ea4d09f556a4b9f3b64c2fd136e87e3a55/node_modules/bluebird/", {"name":"bluebird","reference":"2.9.26"}],
  ["../../Library/Caches/Yarn/v4/npm-bluebird-3.5.5-a8d0afd73251effbbd5fe384a77d73003c17a71f/node_modules/bluebird/", {"name":"bluebird","reference":"3.5.5"}],
  ["../../Library/Caches/Yarn/v4/npm-regexp-clone-0.0.1-a7c2e09891fdbf38fbb10d376fb73003e68ac589/node_modules/regexp-clone/", {"name":"regexp-clone","reference":"0.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-sliced-0.0.5-5edc044ca4eb6f7816d50ba2fc63e25d8fe4707f/node_modules/sliced/", {"name":"sliced","reference":"0.0.5"}],
  ["../../Library/Caches/Yarn/v4/npm-muri-1.0.0-de3bf6bd71d67eae71d76689b950d2de118695c6/node_modules/muri/", {"name":"muri","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-morgan-1.9.1-0a8d16734a1d9afbc824b99df87e738e58e2da59/node_modules/morgan/", {"name":"morgan","reference":"1.9.1"}],
  ["../../Library/Caches/Yarn/v4/npm-basic-auth-2.0.1-b998279bf47ce38344b4f3cf916d4679bbf51e3a/node_modules/basic-auth/", {"name":"basic-auth","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-safe-buffer-5.1.2-991ec69d296e0313747d59bdfd2b745c35f8828d/node_modules/safe-buffer/", {"name":"safe-buffer","reference":"5.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-safe-buffer-5.2.0-b74daec49b1148f88c64b68d49b1e815c1f2f519/node_modules/safe-buffer/", {"name":"safe-buffer","reference":"5.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-on-headers-1.0.2-772b0ae6aaa525c399e489adfad90c403eb3c28f/node_modules/on-headers/", {"name":"on-headers","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-npmconf-0.0.24-b78875b088ccc3c0afa3eceb3ce3244b1b52390c/node_modules/npmconf/", {"name":"npmconf","reference":"0.0.24"}],
  ["../../Library/Caches/Yarn/v4/npm-config-chain-1.1.12-0fde8d091200eb5e808caf25fe618c02f48e4efa/node_modules/config-chain/", {"name":"config-chain","reference":"1.1.12"}],
  ["../../Library/Caches/Yarn/v4/npm-ini-1.3.5-eee25f56db1c9ec6085e0c22778083f596abf927/node_modules/ini/", {"name":"ini","reference":"1.3.5"}],
  ["../../Library/Caches/Yarn/v4/npm-ini-1.1.0-4e808c2ce144c6c1788918e034d6797bc6cf6281/node_modules/ini/", {"name":"ini","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-proto-list-1.2.4-212d5bfe1318306a420f6402b8e26ff39647a849/node_modules/proto-list/", {"name":"proto-list","reference":"1.2.4"}],
  ["../../Library/Caches/Yarn/v4/npm-mkdirp-0.3.5-de3e5f8961c88c787ee1368df849ac4413eca8d7/node_modules/mkdirp/", {"name":"mkdirp","reference":"0.3.5"}],
  ["../../Library/Caches/Yarn/v4/npm-mkdirp-0.5.1-30057438eac6cf7f8c4767f38648d6697d75c903/node_modules/mkdirp/", {"name":"mkdirp","reference":"0.5.1"}],
  ["../../Library/Caches/Yarn/v4/npm-nopt-2.2.1-2aa09b7d1768487b3b89a9c5aa52335bff0baea7/node_modules/nopt/", {"name":"nopt","reference":"2.2.1"}],
  ["../../Library/Caches/Yarn/v4/npm-nopt-3.0.6-c6465dbf08abcd4db359317f79ac68a646b28ff9/node_modules/nopt/", {"name":"nopt","reference":"3.0.6"}],
  ["../../Library/Caches/Yarn/v4/npm-abbrev-1.1.1-f8f2c887ad10bf67f634f005b6987fed3179aac8/node_modules/abbrev/", {"name":"abbrev","reference":"1.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-abbrev-1.0.9-91b4792588a7738c25f35dd6f63752a2f8776135/node_modules/abbrev/", {"name":"abbrev","reference":"1.0.9"}],
  ["../../Library/Caches/Yarn/v4/npm-osenv-0.0.3-cd6ad8ddb290915ad9e22765576025d411f29cb6/node_modules/osenv/", {"name":"osenv","reference":"0.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-semver-1.1.4-2e5a4e72bab03472cc97f72753b4508912ef5540/node_modules/semver/", {"name":"semver","reference":"1.1.4"}],
  ["../../Library/Caches/Yarn/v4/npm-semver-5.7.1-a954f931aeba508d307bbf069eff0c01c96116f7/node_modules/semver/", {"name":"semver","reference":"5.7.1"}],
  ["../../Library/Caches/Yarn/v4/npm-optional-0.1.4-cdb1a9bedc737d2025f690ceeb50e049444fd5b3/node_modules/optional/", {"name":"optional","reference":"0.1.4"}],
  ["../../Library/Caches/Yarn/v4/npm-st-0.2.4-97318f55485ffcbe7086e22b40d61758923cffa0/node_modules/st/", {"name":"st","reference":"0.2.4"}],
  ["../../Library/Caches/Yarn/v4/npm-async-cache-0.1.5-b7cd396d295aa8c52829bbe30ec33b62426006da/node_modules/async-cache/", {"name":"async-cache","reference":"0.1.5"}],
  ["../../Library/Caches/Yarn/v4/npm-lru-cache-2.3.1-b3adf6b3d856e954e2c390e6cef22081245a53d6/node_modules/lru-cache/", {"name":"lru-cache","reference":"2.3.1"}],
  ["../../Library/Caches/Yarn/v4/npm-lru-cache-4.1.5-8bbe50ea85bed59bc9e33dcab8235ee9bcf443cd/node_modules/lru-cache/", {"name":"lru-cache","reference":"4.1.5"}],
  ["../../Library/Caches/Yarn/v4/npm-fd-0.0.3-b3240de86dbf5a345baae7382a07d4713566ff0c/node_modules/fd/", {"name":"fd","reference":"0.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-stream-buffers-3.0.2-5249005a8d5c2d00b3a32e6e0a6ea209dc4f3521/node_modules/stream-buffers/", {"name":"stream-buffers","reference":"3.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-tap-5.8.0-cbd7164884cbc85566f9c937a2806b911f429adc/node_modules/tap/", {"name":"tap","reference":"5.8.0"}],
  ["../../Library/Caches/Yarn/v4/npm-clean-yaml-object-0.1.0-63fb110dc2ce1a84dc21f6d9334876d010ae8b68/node_modules/clean-yaml-object/", {"name":"clean-yaml-object","reference":"0.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-codecov-io-0.1.6-59dfd02da1ff31c2fb2b952ad8ad16fd3781b728/node_modules/codecov.io/", {"name":"codecov.io","reference":"0.1.6"}],
  ["../../Library/Caches/Yarn/v4/npm-request-2.42.0-572bd0148938564040ac7ab148b96423a063304a/node_modules/request/", {"name":"request","reference":"2.42.0"}],
  ["../../Library/Caches/Yarn/v4/npm-request-2.79.0-4dfe5bf6be8b8cdc37fcf93e04b65577722710de/node_modules/request/", {"name":"request","reference":"2.79.0"}],
  ["../../Library/Caches/Yarn/v4/npm-bl-0.9.5-c06b797af085ea00bc527afc8efcf11de2232054/node_modules/bl/", {"name":"bl","reference":"0.9.5"}],
  ["../../Library/Caches/Yarn/v4/npm-caseless-0.6.0-8167c1ab8397fb5bb95f96d28e5a81c50f247ac4/node_modules/caseless/", {"name":"caseless","reference":"0.6.0"}],
  ["../../Library/Caches/Yarn/v4/npm-caseless-0.11.0-715b96ea9841593cc33067923f5ec60ebda4f7d7/node_modules/caseless/", {"name":"caseless","reference":"0.11.0"}],
  ["../../Library/Caches/Yarn/v4/npm-forever-agent-0.5.2-6d0e09c4921f94a27f63d3b49c5feff1ea4c5130/node_modules/forever-agent/", {"name":"forever-agent","reference":"0.5.2"}],
  ["../../Library/Caches/Yarn/v4/npm-forever-agent-0.6.1-fbc71f0c41adeb37f96c577ad1ed42d8fdacca91/node_modules/forever-agent/", {"name":"forever-agent","reference":"0.6.1"}],
  ["../../Library/Caches/Yarn/v4/npm-json-stringify-safe-5.0.1-1296a2d58fd45f19a0f6ce01d65701e2c735b6eb/node_modules/json-stringify-safe/", {"name":"json-stringify-safe","reference":"5.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-node-uuid-1.4.8-b040eb0923968afabf8d32fb1f17f1167fdab907/node_modules/node-uuid/", {"name":"node-uuid","reference":"1.4.8"}],
  ["../../Library/Caches/Yarn/v4/npm-tunnel-agent-0.4.3-6373db76909fe570e08d73583365ed828a74eeeb/node_modules/tunnel-agent/", {"name":"tunnel-agent","reference":"0.4.3"}],
  ["../../Library/Caches/Yarn/v4/npm-aws-sign2-0.5.0-c57103f7a17fc037f02d7c2e64b602ea223f7d63/node_modules/aws-sign2/", {"name":"aws-sign2","reference":"0.5.0"}],
  ["../../Library/Caches/Yarn/v4/npm-aws-sign2-0.6.0-14342dd38dbcc94d0e5b87d763cd63612c0e794f/node_modules/aws-sign2/", {"name":"aws-sign2","reference":"0.6.0"}],
  ["../../Library/Caches/Yarn/v4/npm-form-data-0.1.4-91abd788aba9702b1aabfa8bc01031a2ac9e3b12/node_modules/form-data/", {"name":"form-data","reference":"0.1.4"}],
  ["../../Library/Caches/Yarn/v4/npm-form-data-2.1.4-33c183acf193276ecaa98143a69e94bfee1750d1/node_modules/form-data/", {"name":"form-data","reference":"2.1.4"}],
  ["../../Library/Caches/Yarn/v4/npm-combined-stream-0.0.7-0137e657baa5a7541c57ac37ac5fc07d73b4dc1f/node_modules/combined-stream/", {"name":"combined-stream","reference":"0.0.7"}],
  ["../../Library/Caches/Yarn/v4/npm-combined-stream-1.0.8-c3d45a8b34fd730631a110a8a2520682b31d5a7f/node_modules/combined-stream/", {"name":"combined-stream","reference":"1.0.8"}],
  ["../../Library/Caches/Yarn/v4/npm-delayed-stream-0.0.5-d4b1f43a93e8296dfe02694f4680bc37a313c73f/node_modules/delayed-stream/", {"name":"delayed-stream","reference":"0.0.5"}],
  ["../../Library/Caches/Yarn/v4/npm-delayed-stream-1.0.0-df3ae199acadfb7d440aaae0b29e2272b24ec619/node_modules/delayed-stream/", {"name":"delayed-stream","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-hawk-1.1.1-87cd491f9b46e4e2aeaca335416766885d2d1ed9/node_modules/hawk/", {"name":"hawk","reference":"1.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-hawk-3.1.3-078444bd7c1640b0fe540d2c9b73d59678e8e1c4/node_modules/hawk/", {"name":"hawk","reference":"3.1.3"}],
  ["../../Library/Caches/Yarn/v4/npm-boom-0.4.2-7a636e9ded4efcefb19cef4947a3c67dfaee911b/node_modules/boom/", {"name":"boom","reference":"0.4.2"}],
  ["../../Library/Caches/Yarn/v4/npm-boom-2.10.1-39c8918ceff5799f83f9492a848f625add0c766f/node_modules/boom/", {"name":"boom","reference":"2.10.1"}],
  ["../../Library/Caches/Yarn/v4/npm-hoek-0.9.1-3d322462badf07716ea7eb85baf88079cddce505/node_modules/hoek/", {"name":"hoek","reference":"0.9.1"}],
  ["../../Library/Caches/Yarn/v4/npm-hoek-2.16.3-20bb7403d3cea398e91dc4710a8ff1b8274a25ed/node_modules/hoek/", {"name":"hoek","reference":"2.16.3"}],
  ["../../Library/Caches/Yarn/v4/npm-cryptiles-0.2.2-ed91ff1f17ad13d3748288594f8a48a0d26f325c/node_modules/cryptiles/", {"name":"cryptiles","reference":"0.2.2"}],
  ["../../Library/Caches/Yarn/v4/npm-cryptiles-2.0.5-3bdfecdc608147c1c67202fa291e7dca59eaa3b8/node_modules/cryptiles/", {"name":"cryptiles","reference":"2.0.5"}],
  ["../../Library/Caches/Yarn/v4/npm-sntp-0.2.4-fb885f18b0f3aad189f824862536bceeec750900/node_modules/sntp/", {"name":"sntp","reference":"0.2.4"}],
  ["../../Library/Caches/Yarn/v4/npm-sntp-1.0.9-6541184cc90aeea6c6e7b35e2659082443c66198/node_modules/sntp/", {"name":"sntp","reference":"1.0.9"}],
  ["../../Library/Caches/Yarn/v4/npm-http-signature-0.10.1-4fbdac132559aa8323121e540779c0a012b27e66/node_modules/http-signature/", {"name":"http-signature","reference":"0.10.1"}],
  ["../../Library/Caches/Yarn/v4/npm-http-signature-1.1.1-df72e267066cd0ac67fb76adf8e134a8fbcf91bf/node_modules/http-signature/", {"name":"http-signature","reference":"1.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-asn1-0.1.11-559be18376d08a4ec4dbe80877d27818639b2df7/node_modules/asn1/", {"name":"asn1","reference":"0.1.11"}],
  ["../../Library/Caches/Yarn/v4/npm-asn1-0.2.4-8d2475dfab553bb33e77b54e59e880bb8ce23136/node_modules/asn1/", {"name":"asn1","reference":"0.2.4"}],
  ["../../Library/Caches/Yarn/v4/npm-assert-plus-0.1.5-ee74009413002d84cec7219c6ac811812e723160/node_modules/assert-plus/", {"name":"assert-plus","reference":"0.1.5"}],
  ["../../Library/Caches/Yarn/v4/npm-assert-plus-0.2.0-d74e1b87e7affc0db8aadb7021f3fe48101ab234/node_modules/assert-plus/", {"name":"assert-plus","reference":"0.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-assert-plus-1.0.0-f12e0f3c5d77b0b1cdd9146942e4e96c1e4dd525/node_modules/assert-plus/", {"name":"assert-plus","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-ctype-0.5.3-82c18c2461f74114ef16c135224ad0b9144ca12f/node_modules/ctype/", {"name":"ctype","reference":"0.5.3"}],
  ["../../Library/Caches/Yarn/v4/npm-oauth-sign-0.4.0-f22956f31ea7151a821e5f2fb32c113cad8b9f69/node_modules/oauth-sign/", {"name":"oauth-sign","reference":"0.4.0"}],
  ["../../Library/Caches/Yarn/v4/npm-oauth-sign-0.8.2-46a6ab7f0aead8deae9ec0565780b7d4efeb9d43/node_modules/oauth-sign/", {"name":"oauth-sign","reference":"0.8.2"}],
  ["../../Library/Caches/Yarn/v4/npm-stringstream-0.0.6-7880225b0d4ad10e30927d167a1d6f2fd3b33a72/node_modules/stringstream/", {"name":"stringstream","reference":"0.0.6"}],
  ["../../Library/Caches/Yarn/v4/npm-tough-cookie-3.0.1-9df4f57e739c26930a018184887f4adb7dca73b2/node_modules/tough-cookie/", {"name":"tough-cookie","reference":"3.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-tough-cookie-2.3.4-ec60cee38ac675063ffc97a5c18970578ee83655/node_modules/tough-cookie/", {"name":"tough-cookie","reference":"2.3.4"}],
  ["../../Library/Caches/Yarn/v4/npm-ip-regex-2.1.0-fa78bf5d2e6913c911ce9f819ee5146bb6d844e9/node_modules/ip-regex/", {"name":"ip-regex","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-psl-1.4.0-5dd26156cdb69fa1fdb8ab1991667d3f80ced7c2/node_modules/psl/", {"name":"psl","reference":"1.4.0"}],
  ["../../Library/Caches/Yarn/v4/npm-punycode-2.1.1-b58b010ac40c22c5657616c8d2c2c02c7bf479ec/node_modules/punycode/", {"name":"punycode","reference":"2.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-punycode-1.4.1-c0d5a63b2718800ad8e1eb0fa5269c84dd41845e/node_modules/punycode/", {"name":"punycode","reference":"1.4.1"}],
  ["../../Library/Caches/Yarn/v4/npm-punycode-1.3.2-9653a036fb7c1ee42342f2325cceefea3926c48d/node_modules/punycode/", {"name":"punycode","reference":"1.3.2"}],
  ["../../Library/Caches/Yarn/v4/npm-urlgrey-0.4.0-f065357040fb35c3b311d4e5dc36484d96dbea06/node_modules/urlgrey/", {"name":"urlgrey","reference":"0.4.0"}],
  ["../../Library/Caches/Yarn/v4/npm-tape-2.3.0-0dfeec709227fbcc9170abe7f046962b271431db/node_modules/tape/", {"name":"tape","reference":"2.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-deep-equal-0.1.2-b246c2b80a570a47c11be1d9bd1070ec878b87ce/node_modules/deep-equal/", {"name":"deep-equal","reference":"0.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-defined-0.0.0-f35eea7d705e933baf13b2f03b3f83d921403b3e/node_modules/defined/", {"name":"defined","reference":"0.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-defined-1.0.0-c98d9bcef75674188e110969151199e39b1fa693/node_modules/defined/", {"name":"defined","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-jsonify-0.0.0-2c74b6ee41d93ca51b7b5aaee8f503631d252a73/node_modules/jsonify/", {"name":"jsonify","reference":"0.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-resumer-0.0.0-f1e8f461e4064ba39e82af3cdc2a8c893d076759/node_modules/resumer/", {"name":"resumer","reference":"0.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-through-2.3.8-0dd4c9ffaabc357960b1b724115d7e0e86a2e1f5/node_modules/through/", {"name":"through","reference":"2.3.8"}],
  ["../../Library/Caches/Yarn/v4/npm-split-0.2.10-67097c601d697ce1368f418f06cd201cf0521a57/node_modules/split/", {"name":"split","reference":"0.2.10"}],
  ["../../Library/Caches/Yarn/v4/npm-stream-combiner-0.0.4-4d5e433c185261dde623ca3f44c586bcf5c4ad14/node_modules/stream-combiner/", {"name":"stream-combiner","reference":"0.0.4"}],
  ["../../Library/Caches/Yarn/v4/npm-duplexer-0.1.1-ace6ff808c1ce66b57d1ebf97977acb02334cfc1/node_modules/duplexer/", {"name":"duplexer","reference":"0.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-coveralls-2.13.3-9ad7c2ae527417f361e8b626483f48ee92dd2bc7/node_modules/coveralls/", {"name":"coveralls","reference":"2.13.3"}],
  ["../../Library/Caches/Yarn/v4/npm-js-yaml-3.6.1-6e5fe67d8b205ce4d22fad05b7781e8dadcc4b30/node_modules/js-yaml/", {"name":"js-yaml","reference":"3.6.1"}],
  ["../../Library/Caches/Yarn/v4/npm-js-yaml-3.13.1-aff151b30bfdfa8e49e05da22e7415e9dfa37847/node_modules/js-yaml/", {"name":"js-yaml","reference":"3.13.1"}],
  ["../../Library/Caches/Yarn/v4/npm-argparse-1.0.10-bcd6791ea5ae09725e17e5ad988134cd40b3d911/node_modules/argparse/", {"name":"argparse","reference":"1.0.10"}],
  ["../../Library/Caches/Yarn/v4/npm-sprintf-js-1.0.3-04e6926f662895354f3dd015203633b857297e2c/node_modules/sprintf-js/", {"name":"sprintf-js","reference":"1.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-esprima-2.7.3-96e3b70d5779f6ad49cd032673d1c312767ba581/node_modules/esprima/", {"name":"esprima","reference":"2.7.3"}],
  ["../../Library/Caches/Yarn/v4/npm-esprima-4.0.1-13b04cdb3e6c5d19df91ab6987a8695619b0aa71/node_modules/esprima/", {"name":"esprima","reference":"4.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-lcov-parse-0.0.10-1b0b8ff9ac9c7889250582b70b71315d9da6d9a3/node_modules/lcov-parse/", {"name":"lcov-parse","reference":"0.0.10"}],
  ["../../Library/Caches/Yarn/v4/npm-log-driver-1.2.5-7ae4ec257302fd790d557cb10c97100d857b0056/node_modules/log-driver/", {"name":"log-driver","reference":"1.2.5"}],
  ["../../Library/Caches/Yarn/v4/npm-minimist-1.2.0-a35008b20f41383eec1fb914f4cd5df79a264284/node_modules/minimist/", {"name":"minimist","reference":"1.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-minimist-0.0.8-857fcabfc3397d2625b8228262e86aa7a011b05d/node_modules/minimist/", {"name":"minimist","reference":"0.0.8"}],
  ["../../Library/Caches/Yarn/v4/npm-minimist-0.0.10-de3f98543dbf96082be48ad1a0c7cda836301dcf/node_modules/minimist/", {"name":"minimist","reference":"0.0.10"}],
  ["../../Library/Caches/Yarn/v4/npm-aws4-1.8.0-f0e003d9ca9e7f59c7a508945d7b2ef9a04a542f/node_modules/aws4/", {"name":"aws4","reference":"1.8.0"}],
  ["../../Library/Caches/Yarn/v4/npm-extend-3.0.2-f8b1136b4071fbd8eb140aff858b1019ec2915fa/node_modules/extend/", {"name":"extend","reference":"3.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-asynckit-0.4.0-c79ed97f7f34cb8f2ba1bc9790bcc366474b4b79/node_modules/asynckit/", {"name":"asynckit","reference":"0.4.0"}],
  ["../../Library/Caches/Yarn/v4/npm-har-validator-2.0.6-cdcbc08188265ad119b6a5a7c8ab70eecfb5d27d/node_modules/har-validator/", {"name":"har-validator","reference":"2.0.6"}],
  ["../../Library/Caches/Yarn/v4/npm-chalk-1.1.3-a8115c55e4a702fe4d150abd3872822a7e09fc98/node_modules/chalk/", {"name":"chalk","reference":"1.1.3"}],
  ["../../Library/Caches/Yarn/v4/npm-ansi-styles-2.2.1-b432dd3358b634cf75e1e4664368240533c1ddbe/node_modules/ansi-styles/", {"name":"ansi-styles","reference":"2.2.1"}],
  ["../../Library/Caches/Yarn/v4/npm-escape-string-regexp-1.0.5-1b61c0562190a8dff6ae3bb2cf0200ca130b86d4/node_modules/escape-string-regexp/", {"name":"escape-string-regexp","reference":"1.0.5"}],
  ["../../Library/Caches/Yarn/v4/npm-has-ansi-2.0.0-34f5049ce1ecdf2b0649af3ef24e45ed35416d91/node_modules/has-ansi/", {"name":"has-ansi","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-ansi-regex-2.1.1-c3b33ab5ee360d86e0e628f0468ae7ef27d654df/node_modules/ansi-regex/", {"name":"ansi-regex","reference":"2.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-strip-ansi-3.0.1-6a385fb8853d952d5ff05d0e8aaf94278dc63dcf/node_modules/strip-ansi/", {"name":"strip-ansi","reference":"3.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-supports-color-2.0.0-535d045ce6b6363fa40117084629995e9df324c7/node_modules/supports-color/", {"name":"supports-color","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-supports-color-3.2.3-65ac0504b3954171d8a64946b2ae3cbb8a5f54f6/node_modules/supports-color/", {"name":"supports-color","reference":"3.2.3"}],
  ["../../Library/Caches/Yarn/v4/npm-supports-color-1.3.1-15758df09d8ff3b4acc307539fabe27095e1042d/node_modules/supports-color/", {"name":"supports-color","reference":"1.3.1"}],
  ["../../Library/Caches/Yarn/v4/npm-commander-2.20.0-d58bb2b5c1ee8f87b0d340027e9e94e222c5a422/node_modules/commander/", {"name":"commander","reference":"2.20.0"}],
  ["../../Library/Caches/Yarn/v4/npm-is-my-json-valid-2.20.0-1345a6fca3e8daefc10d0fa77067f54cedafd59a/node_modules/is-my-json-valid/", {"name":"is-my-json-valid","reference":"2.20.0"}],
  ["../../Library/Caches/Yarn/v4/npm-generate-function-2.3.1-f069617690c10c868e73b8465746764f97c3479f/node_modules/generate-function/", {"name":"generate-function","reference":"2.3.1"}],
  ["../../Library/Caches/Yarn/v4/npm-is-property-1.0.2-57fe1c4e48474edd65b09911f26b1cd4095dda84/node_modules/is-property/", {"name":"is-property","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-generate-object-property-1.2.0-9c0e1c40308ce804f4783618b937fa88f99d50d0/node_modules/generate-object-property/", {"name":"generate-object-property","reference":"1.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-is-my-ip-valid-1.0.0-7b351b8e8edd4d3995d4d066680e664d94696824/node_modules/is-my-ip-valid/", {"name":"is-my-ip-valid","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-jsonpointer-4.0.1-4fd92cb34e0e9db3c89c8622ecf51f9b978c6cb9/node_modules/jsonpointer/", {"name":"jsonpointer","reference":"4.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-xtend-4.0.2-bb72779f5fa465186b1f438f674fa347fdb5db54/node_modules/xtend/", {"name":"xtend","reference":"4.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-pinkie-promise-2.0.1-2135d6dfa7a358c069ac9b178776288228450ffa/node_modules/pinkie-promise/", {"name":"pinkie-promise","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-pinkie-2.0.4-72556b80cfa0d48a974e80e77248e80ed4f7f870/node_modules/pinkie/", {"name":"pinkie","reference":"2.0.4"}],
  ["../../Library/Caches/Yarn/v4/npm-jsprim-1.4.1-313e66bc1e5cc06e438bc1b7499c2e5c56acb6a2/node_modules/jsprim/", {"name":"jsprim","reference":"1.4.1"}],
  ["../../Library/Caches/Yarn/v4/npm-extsprintf-1.3.0-96918440e3041a7a414f8c52e3c574eb3c3e1e05/node_modules/extsprintf/", {"name":"extsprintf","reference":"1.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-extsprintf-1.4.0-e2689f8f356fad62cca65a3a91c5df5f9551692f/node_modules/extsprintf/", {"name":"extsprintf","reference":"1.4.0"}],
  ["../../Library/Caches/Yarn/v4/npm-json-schema-0.2.3-b480c892e59a2f05954ce727bd3f2a4e882f9e13/node_modules/json-schema/", {"name":"json-schema","reference":"0.2.3"}],
  ["../../Library/Caches/Yarn/v4/npm-verror-1.10.0-3a105ca17053af55d6e270c1f8288682e18da400/node_modules/verror/", {"name":"verror","reference":"1.10.0"}],
  ["../../Library/Caches/Yarn/v4/npm-sshpk-1.16.1-fb661c0bef29b39db40769ee39fa70093d6f6877/node_modules/sshpk/", {"name":"sshpk","reference":"1.16.1"}],
  ["../../Library/Caches/Yarn/v4/npm-safer-buffer-2.1.2-44fa161b0187b9549dd84bb91802f9bd8385cd6a/node_modules/safer-buffer/", {"name":"safer-buffer","reference":"2.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-bcrypt-pbkdf-1.0.2-a4301d389b6a43f9b67ff3ca11a3f6637e360e9e/node_modules/bcrypt-pbkdf/", {"name":"bcrypt-pbkdf","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-tweetnacl-0.14.5-5ae68177f192d4456269d108afa93ff8743f4f64/node_modules/tweetnacl/", {"name":"tweetnacl","reference":"0.14.5"}],
  ["../../Library/Caches/Yarn/v4/npm-dashdash-1.14.1-853cfa0f7cbe2fed5de20326b8dd581035f6e2f0/node_modules/dashdash/", {"name":"dashdash","reference":"1.14.1"}],
  ["../../Library/Caches/Yarn/v4/npm-ecc-jsbn-0.1.2-3a83a904e54353287874c564b7549386849a98c9/node_modules/ecc-jsbn/", {"name":"ecc-jsbn","reference":"0.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-jsbn-0.1.1-a5e654c2e5a2deb5f201d96cefbca80c0ef2f513/node_modules/jsbn/", {"name":"jsbn","reference":"0.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-getpass-0.1.7-5eff8e3e684d569ae4cb2b1282604e8ba62149fa/node_modules/getpass/", {"name":"getpass","reference":"0.1.7"}],
  ["../../Library/Caches/Yarn/v4/npm-is-typedarray-1.0.0-e479c80858df0c1b11ddda6940f96011fcda4a9a/node_modules/is-typedarray/", {"name":"is-typedarray","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-isstream-0.1.2-47e63f7af55afa6f92e1500e690eb8b8529c099a/node_modules/isstream/", {"name":"isstream","reference":"0.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-uuid-3.3.3-4568f0216e78760ee1dbf3a4d2cf53e224112866/node_modules/uuid/", {"name":"uuid","reference":"3.3.3"}],
  ["../../Library/Caches/Yarn/v4/npm-deeper-2.1.0-bc564e5f73174fdf201e08b00030e8a14da74368/node_modules/deeper/", {"name":"deeper","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-foreground-child-1.5.6-4fd71ad2dfde96789b980a5c0a295937cb2f5ce9/node_modules/foreground-child/", {"name":"foreground-child","reference":"1.5.6"}],
  ["../../Library/Caches/Yarn/v4/npm-cross-spawn-4.0.2-7b9247621c23adfdd3856004a823cbe397424d41/node_modules/cross-spawn/", {"name":"cross-spawn","reference":"4.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-pseudomap-1.0.2-f052a28da70e618917ef0a8ac34c1ae5a68286b3/node_modules/pseudomap/", {"name":"pseudomap","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-yallist-2.1.2-1c11f9218f076089a47dd512f93c6699a6a81d52/node_modules/yallist/", {"name":"yallist","reference":"2.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-which-1.3.1-a45043d54f5805316da8d62f9f50918d3da70b0a/node_modules/which/", {"name":"which","reference":"1.3.1"}],
  ["../../Library/Caches/Yarn/v4/npm-isexe-2.0.0-e8fbf374dc556ff8947a10dcb0572d633f2cfa10/node_modules/isexe/", {"name":"isexe","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-isexe-1.1.2-36f3e22e60750920f5e7241a476a8c6a42275ad0/node_modules/isexe/", {"name":"isexe","reference":"1.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-signal-exit-3.0.2-b5fdc08f1287ea1178628e415e25132b73646c6d/node_modules/signal-exit/", {"name":"signal-exit","reference":"3.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-signal-exit-2.1.2-375879b1f92ebc3b334480d038dc546a6d558564/node_modules/signal-exit/", {"name":"signal-exit","reference":"2.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-nyc-6.6.1-2f6014610a57070021c4c067e9b9e330a23ac6a7/node_modules/nyc/", {"name":"nyc","reference":"6.6.1"}],
  ["../../Library/Caches/Yarn/v4/npm-append-transform-0.4.0-d76ebf8ca94d276e247a36bad44a4b74ab611991/node_modules/append-transform/", {"name":"append-transform","reference":"0.4.0"}],
  ["../../Library/Caches/Yarn/v4/npm-default-require-extensions-1.0.0-f37ea15d3e13ffd9b437d33e1a75b5fb97874cb8/node_modules/default-require-extensions/", {"name":"default-require-extensions","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-strip-bom-2.0.0-6219a85616520491f35788bdbf1447a99c7e6b0e/node_modules/strip-bom/", {"name":"strip-bom","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-is-utf8-0.2.1-4b0da1442104d1b336340e80797e865cf39f7d72/node_modules/is-utf8/", {"name":"is-utf8","reference":"0.2.1"}],
  ["../../Library/Caches/Yarn/v4/npm-arrify-1.0.1-898508da2226f380df904728456849c1501a4b0d/node_modules/arrify/", {"name":"arrify","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-caching-transform-1.0.1-6dbdb2f20f8d8fbce79f3e94e9d1742dcdf5c0a1/node_modules/caching-transform/", {"name":"caching-transform","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-md5-hex-1.3.0-d2c4afe983c4370662179b8cad145219135046c4/node_modules/md5-hex/", {"name":"md5-hex","reference":"1.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-md5-o-matic-0.1.1-822bccd65e117c514fab176b25945d54100a03c3/node_modules/md5-o-matic/", {"name":"md5-o-matic","reference":"0.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-write-file-atomic-1.3.4-f807a4f0b1d9e913ae7a48112e6cc3af1991b45f/node_modules/write-file-atomic/", {"name":"write-file-atomic","reference":"1.3.4"}],
  ["../../Library/Caches/Yarn/v4/npm-imurmurhash-0.1.4-9218b9b2b928a238b13dc4fb6b6d576f231453ea/node_modules/imurmurhash/", {"name":"imurmurhash","reference":"0.1.4"}],
  ["../../Library/Caches/Yarn/v4/npm-slide-1.1.6-56eb027d65b4d2dce6cb2e2d32c4d4afc9e1d707/node_modules/slide/", {"name":"slide","reference":"1.1.6"}],
  ["../../Library/Caches/Yarn/v4/npm-convert-source-map-1.6.0-51b537a8c43e0f04dec1993bffcdd504e758ac20/node_modules/convert-source-map/", {"name":"convert-source-map","reference":"1.6.0"}],
  ["../../Library/Caches/Yarn/v4/npm-convert-source-map-1.1.3-4829c877e9fe49b3161f3bf3673888e204699860/node_modules/convert-source-map/", {"name":"convert-source-map","reference":"1.1.3"}],
  ["../../Library/Caches/Yarn/v4/npm-find-cache-dir-0.1.1-c8defae57c8a52a8a784f9e31c57c742e993a0b9/node_modules/find-cache-dir/", {"name":"find-cache-dir","reference":"0.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-commondir-1.0.1-ddd800da0c66127393cca5950ea968a3aaf1253b/node_modules/commondir/", {"name":"commondir","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-pkg-dir-1.0.0-7a4b508a8d5bb2d629d447056ff4e9c9314cf3d4/node_modules/pkg-dir/", {"name":"pkg-dir","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-find-up-1.1.2-6b2e9822b1a2ce0a60ab64d610eccad53cb24d0f/node_modules/find-up/", {"name":"find-up","reference":"1.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-path-exists-2.1.0-0feb6c64f0fc518d9a754dd5efb62c7022761f4b/node_modules/path-exists/", {"name":"path-exists","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-istanbul-0.4.5-65c7d73d4c4da84d4f3ac310b918fb0b8033733b/node_modules/istanbul/", {"name":"istanbul","reference":"0.4.5"}],
  ["../../Library/Caches/Yarn/v4/npm-escodegen-1.8.1-5a5b53af4693110bebb0867aa3430dd3b70a1018/node_modules/escodegen/", {"name":"escodegen","reference":"1.8.1"}],
  ["../../Library/Caches/Yarn/v4/npm-estraverse-1.9.3-af67f2dc922582415950926091a4005d29c9bb44/node_modules/estraverse/", {"name":"estraverse","reference":"1.9.3"}],
  ["../../Library/Caches/Yarn/v4/npm-esutils-2.0.3-74d2eb4de0b8da1293711910d50775b9b710ef64/node_modules/esutils/", {"name":"esutils","reference":"2.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-optionator-0.8.2-364c5e409d3f4d6301d6c0b4c05bba50180aeb64/node_modules/optionator/", {"name":"optionator","reference":"0.8.2"}],
  ["../../Library/Caches/Yarn/v4/npm-deep-is-0.1.3-b369d6fb5dbc13eecf524f91b070feedc357cf34/node_modules/deep-is/", {"name":"deep-is","reference":"0.1.3"}],
  ["../../Library/Caches/Yarn/v4/npm-fast-levenshtein-2.0.6-3d8a5c66883a16a30ca8643e851f19baa7797917/node_modules/fast-levenshtein/", {"name":"fast-levenshtein","reference":"2.0.6"}],
  ["../../Library/Caches/Yarn/v4/npm-levn-0.3.0-3b09924edf9f083c0490fdd4c0bc4421e04764ee/node_modules/levn/", {"name":"levn","reference":"0.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-prelude-ls-1.1.2-21932a549f5e52ffd9a827f570e04be62a97da54/node_modules/prelude-ls/", {"name":"prelude-ls","reference":"1.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-type-check-0.3.2-5884cab512cf1d355e3fb784f30804b2b520db72/node_modules/type-check/", {"name":"type-check","reference":"0.3.2"}],
  ["../../Library/Caches/Yarn/v4/npm-wordwrap-1.0.0-27584810891456a4171c8d0226441ade90cbcaeb/node_modules/wordwrap/", {"name":"wordwrap","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-wordwrap-0.0.3-a3d5da6cd5c0bc0008d37234bbaf1bed63059107/node_modules/wordwrap/", {"name":"wordwrap","reference":"0.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-source-map-0.2.0-dab73fbcfc2ba819b4de03bd6f6eaa48164b3f9d/node_modules/source-map/", {"name":"source-map","reference":"0.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-source-map-0.6.1-74722af32e9614e9c287a8d0bbde48b5e2f1a263/node_modules/source-map/", {"name":"source-map","reference":"0.6.1"}],
  ["../../Library/Caches/Yarn/v4/npm-source-map-0.5.7-8a039d2d1021d22d1ea14c80d8ea468ba2ef3fcc/node_modules/source-map/", {"name":"source-map","reference":"0.5.7"}],
  ["../../Library/Caches/Yarn/v4/npm-amdefine-1.0.1-4a5282ac164729e93619bcfd3ad151f817ce91f5/node_modules/amdefine/", {"name":"amdefine","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-handlebars-4.3.0-427391b584626c9c9c6ffb7d1fb90aa9789221cc/node_modules/handlebars/", {"name":"handlebars","reference":"4.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-neo-async-2.6.1-ac27ada66167fa8849a6addd837f6b189ad2081c/node_modules/neo-async/", {"name":"neo-async","reference":"2.6.1"}],
  ["../../Library/Caches/Yarn/v4/npm-optimist-0.6.1-da3ea74686fa21a19a111c326e90eb15a0196686/node_modules/optimist/", {"name":"optimist","reference":"0.6.1"}],
  ["../../Library/Caches/Yarn/v4/npm-uglify-js-3.6.0-704681345c53a8b2079fb6cec294b05ead242ff5/node_modules/uglify-js/", {"name":"uglify-js","reference":"3.6.0"}],
  ["../../Library/Caches/Yarn/v4/npm-resolve-1.1.7-203114d82ad2c5ed9e8e0411b3932875e889e97b/node_modules/resolve/", {"name":"resolve","reference":"1.1.7"}],
  ["../../Library/Caches/Yarn/v4/npm-resolve-1.12.0-3fc644a35c84a48554609ff26ec52b66fa577df6/node_modules/resolve/", {"name":"resolve","reference":"1.12.0"}],
  ["../../Library/Caches/Yarn/v4/npm-has-flag-1.0.0-9d9e793165ce017a00f00418c43f942a7b1d11fa/node_modules/has-flag/", {"name":"has-flag","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-micromatch-2.3.11-86677c97d1720b363431d04d0d15293bd38c1565/node_modules/micromatch/", {"name":"micromatch","reference":"2.3.11"}],
  ["../../Library/Caches/Yarn/v4/npm-arr-diff-2.0.0-8f3b827f955a8bd669697e4a4256ac3ceae356cf/node_modules/arr-diff/", {"name":"arr-diff","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-arr-flatten-1.1.0-36048bbff4e7b47e136644316c99669ea5ae91f1/node_modules/arr-flatten/", {"name":"arr-flatten","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-array-unique-0.2.1-a1d97ccafcbc2625cc70fadceb36a50c58b01a53/node_modules/array-unique/", {"name":"array-unique","reference":"0.2.1"}],
  ["../../Library/Caches/Yarn/v4/npm-braces-1.8.5-ba77962e12dff969d6b76711e914b737857bf6a7/node_modules/braces/", {"name":"braces","reference":"1.8.5"}],
  ["../../Library/Caches/Yarn/v4/npm-expand-range-1.8.2-a299effd335fe2721ebae8e257ec79644fc85337/node_modules/expand-range/", {"name":"expand-range","reference":"1.8.2"}],
  ["../../Library/Caches/Yarn/v4/npm-fill-range-2.2.4-eb1e773abb056dcd8df2bfdf6af59b8b3a936565/node_modules/fill-range/", {"name":"fill-range","reference":"2.2.4"}],
  ["../../Library/Caches/Yarn/v4/npm-is-number-2.1.0-01fcbbb393463a548f2f466cce16dece49db908f/node_modules/is-number/", {"name":"is-number","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-is-number-4.0.0-0026e37f5454d73e356dfe6564699867c6a7f0ff/node_modules/is-number/", {"name":"is-number","reference":"4.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-kind-of-3.2.2-31ea21a734bab9bbb0f32466d893aea51e4a3c64/node_modules/kind-of/", {"name":"kind-of","reference":"3.2.2"}],
  ["../../Library/Caches/Yarn/v4/npm-kind-of-6.0.2-01146b36a6218e64e58f3a8d66de5d7fc6f6d051/node_modules/kind-of/", {"name":"kind-of","reference":"6.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-is-buffer-1.1.6-efaa2ea9daa0d7ab2ea13a97b2b8ad51fefbe8be/node_modules/is-buffer/", {"name":"is-buffer","reference":"1.1.6"}],
  ["../../Library/Caches/Yarn/v4/npm-isobject-2.1.0-f065561096a3f1da2ef46272f815c840d87e0c89/node_modules/isobject/", {"name":"isobject","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-randomatic-3.1.1-b776efc59375984e36c537b2f51a1f0aff0da1ed/node_modules/randomatic/", {"name":"randomatic","reference":"3.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-math-random-1.0.4-5dd6943c938548267016d4e34f057583080c514c/node_modules/math-random/", {"name":"math-random","reference":"1.0.4"}],
  ["../../Library/Caches/Yarn/v4/npm-repeat-element-1.1.3-782e0d825c0c5a3bb39731f84efee6b742e6b1ce/node_modules/repeat-element/", {"name":"repeat-element","reference":"1.1.3"}],
  ["../../Library/Caches/Yarn/v4/npm-repeat-string-1.6.1-8dcae470e1c88abc2d600fff4a776286da75e637/node_modules/repeat-string/", {"name":"repeat-string","reference":"1.6.1"}],
  ["../../Library/Caches/Yarn/v4/npm-preserve-0.2.0-815ed1f6ebc65926f865b310c0713bcb3315ce4b/node_modules/preserve/", {"name":"preserve","reference":"0.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-expand-brackets-0.1.5-df07284e342a807cd733ac5af72411e581d1177b/node_modules/expand-brackets/", {"name":"expand-brackets","reference":"0.1.5"}],
  ["../../Library/Caches/Yarn/v4/npm-is-posix-bracket-0.1.1-3334dc79774368e92f016e6fbc0a88f5cd6e6bc4/node_modules/is-posix-bracket/", {"name":"is-posix-bracket","reference":"0.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-extglob-0.3.2-2e18ff3d2f49ab2765cec9023f011daa8d8349a1/node_modules/extglob/", {"name":"extglob","reference":"0.3.2"}],
  ["../../Library/Caches/Yarn/v4/npm-is-extglob-1.0.0-ac468177c4943405a092fc8f29760c6ffc6206c0/node_modules/is-extglob/", {"name":"is-extglob","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-filename-regex-2.0.1-c1c4b9bee3e09725ddb106b75c1e301fe2f18b26/node_modules/filename-regex/", {"name":"filename-regex","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-is-glob-2.0.1-d096f926a3ded5600f3fdfd91198cb0888c2d863/node_modules/is-glob/", {"name":"is-glob","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-normalize-path-2.1.1-1ab28b556e198363a8c1a6f7e6fa20137fe6aed9/node_modules/normalize-path/", {"name":"normalize-path","reference":"2.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-remove-trailing-separator-1.1.0-c24bce2a283adad5bc3f58e0d48249b92379d8ef/node_modules/remove-trailing-separator/", {"name":"remove-trailing-separator","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-object-omit-2.0.1-1a9c744829f39dbb858c76ca3579ae2a54ebd1fa/node_modules/object.omit/", {"name":"object.omit","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-for-own-0.1.5-5265c681a4f294dabbf17c9509b6763aa84510ce/node_modules/for-own/", {"name":"for-own","reference":"0.1.5"}],
  ["../../Library/Caches/Yarn/v4/npm-for-in-1.0.2-81068d295a8142ec0ac726c6e2200c30fb6d5e80/node_modules/for-in/", {"name":"for-in","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-is-extendable-0.1.1-62b110e289a471418e3ec36a617d472e301dfc89/node_modules/is-extendable/", {"name":"is-extendable","reference":"0.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-parse-glob-3.0.4-b2c376cfb11f35513badd173ef0bb6e3a388391c/node_modules/parse-glob/", {"name":"parse-glob","reference":"3.0.4"}],
  ["../../Library/Caches/Yarn/v4/npm-glob-base-0.3.0-dbb164f6221b1c0b1ccf82aea328b497df0ea3c4/node_modules/glob-base/", {"name":"glob-base","reference":"0.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-glob-parent-2.0.0-81383d72db054fcccf5336daa902f182f6edbb28/node_modules/glob-parent/", {"name":"glob-parent","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-is-dotfile-1.0.3-a6a2f32ffd2dfb04f5ca25ecd0f6b83cf798a1e1/node_modules/is-dotfile/", {"name":"is-dotfile","reference":"1.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-regex-cache-0.4.4-75bdc58a2a1496cec48a12835bc54c8d562336dd/node_modules/regex-cache/", {"name":"regex-cache","reference":"0.4.4"}],
  ["../../Library/Caches/Yarn/v4/npm-is-equal-shallow-0.1.3-2238098fc221de0bcfa5d9eac4c45d638aa1c534/node_modules/is-equal-shallow/", {"name":"is-equal-shallow","reference":"0.1.3"}],
  ["../../Library/Caches/Yarn/v4/npm-is-primitive-2.0.0-207bab91638499c07b2adf240a41a87210034575/node_modules/is-primitive/", {"name":"is-primitive","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-pkg-up-1.0.0-3e08fb461525c4421624a33b9f7e6d0af5b05a26/node_modules/pkg-up/", {"name":"pkg-up","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-resolve-from-2.0.0-9480ab20e94ffa1d9e80a804c7ea147611966b57/node_modules/resolve-from/", {"name":"resolve-from","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-spawn-wrap-1.4.3-81b7670e170cca247d80bf5faf0cfb713bdcf848/node_modules/spawn-wrap/", {"name":"spawn-wrap","reference":"1.4.3"}],
  ["../../Library/Caches/Yarn/v4/npm-os-homedir-1.0.2-ffbc4988336e0e833de0c168c7ef152121aa7fb3/node_modules/os-homedir/", {"name":"os-homedir","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-test-exclude-1.1.0-f5ddd718927b12fd02f270a0aa939ceb6eea4151/node_modules/test-exclude/", {"name":"test-exclude","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-lodash-assign-4.2.0-0d99f3ccd7a6d261d19bdaeb9245005d285808e7/node_modules/lodash.assign/", {"name":"lodash.assign","reference":"4.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-read-pkg-up-1.0.1-9d63c13276c065918d57f002a57f40a1b643fb02/node_modules/read-pkg-up/", {"name":"read-pkg-up","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-read-pkg-1.1.0-f5ffaa5ecd29cb31c0474bca7d756b6bb29e3f28/node_modules/read-pkg/", {"name":"read-pkg","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-load-json-file-1.1.0-956905708d58b4bab4c2261b04f59f31c99374c0/node_modules/load-json-file/", {"name":"load-json-file","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-parse-json-2.2.0-f480f40434ef80741f8469099f8dea18f55a4dc9/node_modules/parse-json/", {"name":"parse-json","reference":"2.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-error-ex-1.3.2-b4ac40648107fdcdcfae242f428bea8a14d4f1bf/node_modules/error-ex/", {"name":"error-ex","reference":"1.3.2"}],
  ["../../Library/Caches/Yarn/v4/npm-is-arrayish-0.2.1-77c99840527aa8ecb1a8ba697b80645a7a926a9d/node_modules/is-arrayish/", {"name":"is-arrayish","reference":"0.2.1"}],
  ["../../Library/Caches/Yarn/v4/npm-pify-2.3.0-ed141a6ac043a849ea588498e7dca8b15330e90c/node_modules/pify/", {"name":"pify","reference":"2.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-normalize-package-data-2.5.0-e66db1838b200c1dfc233225d12cb36520e234a8/node_modules/normalize-package-data/", {"name":"normalize-package-data","reference":"2.5.0"}],
  ["../../Library/Caches/Yarn/v4/npm-hosted-git-info-2.8.4-44119abaf4bc64692a16ace34700fed9c03e2546/node_modules/hosted-git-info/", {"name":"hosted-git-info","reference":"2.8.4"}],
  ["../../Library/Caches/Yarn/v4/npm-path-parse-1.0.6-d62dbb5679405d72c4737ec58600e9ddcf06d24c/node_modules/path-parse/", {"name":"path-parse","reference":"1.0.6"}],
  ["../../Library/Caches/Yarn/v4/npm-validate-npm-package-license-3.0.4-fc91f6b9c7ba15c857f4cb2c5defeec39d4f410a/node_modules/validate-npm-package-license/", {"name":"validate-npm-package-license","reference":"3.0.4"}],
  ["../../Library/Caches/Yarn/v4/npm-spdx-correct-3.1.0-fb83e504445268f154b074e218c87c003cd31df4/node_modules/spdx-correct/", {"name":"spdx-correct","reference":"3.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-spdx-expression-parse-3.0.0-99e119b7a5da00e05491c9fa338b7904823b41d0/node_modules/spdx-expression-parse/", {"name":"spdx-expression-parse","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-spdx-exceptions-2.2.0-2ea450aee74f2a89bfb94519c07fcd6f41322977/node_modules/spdx-exceptions/", {"name":"spdx-exceptions","reference":"2.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-spdx-license-ids-3.0.5-3694b5804567a458d3c8045842a6358632f62654/node_modules/spdx-license-ids/", {"name":"spdx-license-ids","reference":"3.0.5"}],
  ["../../Library/Caches/Yarn/v4/npm-path-type-1.1.0-59c44f7ee491da704da415da5a4070ba4f8fe441/node_modules/path-type/", {"name":"path-type","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-require-main-filename-1.0.1-97f717b69d48784f5f526a6c5aa8ffdda055a4d1/node_modules/require-main-filename/", {"name":"require-main-filename","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-yargs-4.8.1-c0c42924ca4aaa6b0e6da1739dfb216439f9ddc0/node_modules/yargs/", {"name":"yargs","reference":"4.8.1"}],
  ["../../Library/Caches/Yarn/v4/npm-cliui-3.2.0-120601537a916d29940f934da3b48d585a39213d/node_modules/cliui/", {"name":"cliui","reference":"3.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-string-width-1.0.2-118bdf5b8cdc51a2a7e70d211e07e2b0b9b107d3/node_modules/string-width/", {"name":"string-width","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-code-point-at-1.1.0-0d070b4d043a5bea33a2f1a40e2edb3d9a4ccf77/node_modules/code-point-at/", {"name":"code-point-at","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-is-fullwidth-code-point-1.0.0-ef9e31386f031a7f0d643af82fde50c457ef00cb/node_modules/is-fullwidth-code-point/", {"name":"is-fullwidth-code-point","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-number-is-nan-1.0.1-097b602b53422a522c1afb8790318336941a011d/node_modules/number-is-nan/", {"name":"number-is-nan","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-wrap-ansi-2.1.0-d8fc3d284dd05794fe84973caecdd1cf824fdd85/node_modules/wrap-ansi/", {"name":"wrap-ansi","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-decamelize-1.2.0-f6534d15148269b20352e7bee26f501f9a191290/node_modules/decamelize/", {"name":"decamelize","reference":"1.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-get-caller-file-1.0.3-f978fa4c90d1dfe7ff2d6beda2a515e713bdcf4a/node_modules/get-caller-file/", {"name":"get-caller-file","reference":"1.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-os-locale-1.4.0-20f9f17ae29ed345e8bde583b13d2009803c14d9/node_modules/os-locale/", {"name":"os-locale","reference":"1.4.0"}],
  ["../../Library/Caches/Yarn/v4/npm-lcid-1.0.0-308accafa0bc483a3867b4b6f2b9506251d1b835/node_modules/lcid/", {"name":"lcid","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-invert-kv-1.0.0-104a8e4aaca6d3d8cd157a8ef8bfab2d7a3ffdb6/node_modules/invert-kv/", {"name":"invert-kv","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-require-directory-2.1.1-8c64ad5fd30dab1c976e2344ffe7f792a6a6df42/node_modules/require-directory/", {"name":"require-directory","reference":"2.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-set-blocking-2.0.0-045f9782d011ae9a6803ddd382b24392b3d890f7/node_modules/set-blocking/", {"name":"set-blocking","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-which-module-1.0.0-bba63ca861948994ff307736089e3b96026c2a4f/node_modules/which-module/", {"name":"which-module","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-window-size-0.2.0-b4315bb4214a3d7058ebeee892e13fa24d98b075/node_modules/window-size/", {"name":"window-size","reference":"0.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-y18n-3.2.1-6d15fba884c08679c0d77e88e7759e811e07fa41/node_modules/y18n/", {"name":"y18n","reference":"3.2.1"}],
  ["../../Library/Caches/Yarn/v4/npm-yargs-parser-2.4.1-85568de3cf150ff49fa51825f03a8c880ddcc5c4/node_modules/yargs-parser/", {"name":"yargs-parser","reference":"2.4.1"}],
  ["../../Library/Caches/Yarn/v4/npm-camelcase-3.0.0-32fc4b9fcdaf845fcdf7e73bb97cac2261f0ab0a/node_modules/camelcase/", {"name":"camelcase","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-only-shallow-1.2.0-71cecedba9324bc0518aef10ec080d3249dc2465/node_modules/only-shallow/", {"name":"only-shallow","reference":"1.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-opener-1.5.1-6d2f0e77f1a0af0032aca716c2c1fbb8e7e8abed/node_modules/opener/", {"name":"opener","reference":"1.5.1"}],
  ["../../Library/Caches/Yarn/v4/npm-process-nextick-args-2.0.1-7820d9b16120cc55ca9ae7792680ae7dba6d7fe2/node_modules/process-nextick-args/", {"name":"process-nextick-args","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-process-nextick-args-1.0.7-150e20b756590ad3f91093f25a4f2ad8bff30ba3/node_modules/process-nextick-args/", {"name":"process-nextick-args","reference":"1.0.7"}],
  ["../../Library/Caches/Yarn/v4/npm-util-deprecate-1.0.2-450d4dc9fa70de732762fbd2d4a28981419a0ccf/node_modules/util-deprecate/", {"name":"util-deprecate","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-stack-utils-0.4.0-940cb82fccfa84e8ff2f3fdf293fe78016beccd1/node_modules/stack-utils/", {"name":"stack-utils","reference":"0.4.0"}],
  ["../../Library/Caches/Yarn/v4/npm-tap-mocha-reporter-0.0.27-b2f72f3e1e8ba780ee02918fcdeb3a40da8018f7/node_modules/tap-mocha-reporter/", {"name":"tap-mocha-reporter","reference":"0.0.27"}],
  ["../../Library/Caches/Yarn/v4/npm-color-support-1.1.3-93834379a1cc9a0c61f82f52f0d04322251bd5a2/node_modules/color-support/", {"name":"color-support","reference":"1.1.3"}],
  ["../../Library/Caches/Yarn/v4/npm-diff-1.4.0-7f28d2eb9ee7b15a97efd89ce63dcfdaa3ccbabf/node_modules/diff/", {"name":"diff","reference":"1.4.0"}],
  ["../../Library/Caches/Yarn/v4/npm-tap-parser-1.3.2-120c5089c88c3c8a793ef288867de321e18f8c22/node_modules/tap-parser/", {"name":"tap-parser","reference":"1.3.2"}],
  ["../../Library/Caches/Yarn/v4/npm-events-to-array-1.1.2-2d41f563e1fe400ed4962fe1a4d5c6a7539df7f6/node_modules/events-to-array/", {"name":"events-to-array","reference":"1.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-unicode-length-1.0.3-5ada7a7fed51841a418a328cf149478ac8358abb/node_modules/unicode-length/", {"name":"unicode-length","reference":"1.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-tmatch-2.0.1-0c56246f33f30da1b8d3d72895abaf16660f38cf/node_modules/tmatch/", {"name":"tmatch","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-browserify-13.3.0-b5a9c9020243f0c70e4675bec8223bc627e415ce/node_modules/browserify/", {"name":"browserify","reference":"13.3.0"}],
  ["../../Library/Caches/Yarn/v4/npm-tream-1.3.5-3208c1f08d3a4d99261ab64f92302bc15e111ca0/node_modules/JSONStream/", {"name":"JSONStream","reference":"1.3.5"}],
  ["../../Library/Caches/Yarn/v4/npm-jsonparse-1.3.1-3f4dae4a91fac315f71062f8521cc239f1366280/node_modules/jsonparse/", {"name":"jsonparse","reference":"1.3.1"}],
  ["../../Library/Caches/Yarn/v4/npm-assert-1.5.0-55c109aaf6e0aefdb3dc4b71240c70bf574b18eb/node_modules/assert/", {"name":"assert","reference":"1.5.0"}],
  ["../../Library/Caches/Yarn/v4/npm-object-assign-4.1.1-2109adc7965887cfc05cbbd442cac8bfbb360863/node_modules/object-assign/", {"name":"object-assign","reference":"4.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-util-0.10.3-7afb1afe50805246489e3db7fe0ed379336ac0f9/node_modules/util/", {"name":"util","reference":"0.10.3"}],
  ["../../Library/Caches/Yarn/v4/npm-util-0.10.4-3aa0125bfe668a4672de58857d3ace27ecb76901/node_modules/util/", {"name":"util","reference":"0.10.4"}],
  ["../../Library/Caches/Yarn/v4/npm-browser-pack-6.1.0-c34ba10d0b9ce162b5af227c7131c92c2ecd5774/node_modules/browser-pack/", {"name":"browser-pack","reference":"6.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-combine-source-map-0.8.0-a58d0df042c186fcf822a8e8015f5450d2d79a8b/node_modules/combine-source-map/", {"name":"combine-source-map","reference":"0.8.0"}],
  ["../../Library/Caches/Yarn/v4/npm-inline-source-map-0.6.2-f9393471c18a79d1724f863fa38b586370ade2a5/node_modules/inline-source-map/", {"name":"inline-source-map","reference":"0.6.2"}],
  ["../../Library/Caches/Yarn/v4/npm-lodash-memoize-3.0.4-2dcbd2c287cbc0a55cc42328bd0c736150d53e3f/node_modules/lodash.memoize/", {"name":"lodash.memoize","reference":"3.0.4"}],
  ["../../Library/Caches/Yarn/v4/npm-through2-2.0.5-01c1e39eb31d07cb7d03a96a70823260b23132cd/node_modules/through2/", {"name":"through2","reference":"2.0.5"}],
  ["../../Library/Caches/Yarn/v4/npm-umd-3.0.3-aa9fe653c42b9097678489c01000acb69f0b26cf/node_modules/umd/", {"name":"umd","reference":"3.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-browser-resolve-1.11.3-9b7cbb3d0f510e4cb86bdbd796124d28b5890af6/node_modules/browser-resolve/", {"name":"browser-resolve","reference":"1.11.3"}],
  ["../../Library/Caches/Yarn/v4/npm-browserify-zlib-0.1.4-bb35f8a519f600e0fa6b8485241c979d0141fb2d/node_modules/browserify-zlib/", {"name":"browserify-zlib","reference":"0.1.4"}],
  ["../../Library/Caches/Yarn/v4/npm-pako-0.2.9-f3f7522f4ef782348da8161bad9ecfd51bf83a75/node_modules/pako/", {"name":"pako","reference":"0.2.9"}],
  ["../../Library/Caches/Yarn/v4/npm-buffer-4.9.1-6d1bb601b07a4efced97094132093027c95bc298/node_modules/buffer/", {"name":"buffer","reference":"4.9.1"}],
  ["../../Library/Caches/Yarn/v4/npm-base64-js-1.3.1-58ece8cb75dd07e71ed08c736abc5fac4dbf8df1/node_modules/base64-js/", {"name":"base64-js","reference":"1.3.1"}],
  ["../../Library/Caches/Yarn/v4/npm-ieee754-1.1.13-ec168558e95aa181fd87d37f55c32bbcb6708b84/node_modules/ieee754/", {"name":"ieee754","reference":"1.1.13"}],
  ["../../Library/Caches/Yarn/v4/npm-cached-path-relative-1.0.2-a13df4196d26776220cc3356eb147a52dba2c6db/node_modules/cached-path-relative/", {"name":"cached-path-relative","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-concat-stream-1.5.2-708978624d856af41a5a741defdd261da752c266/node_modules/concat-stream/", {"name":"concat-stream","reference":"1.5.2"}],
  ["../../Library/Caches/Yarn/v4/npm-concat-stream-1.6.2-904bdf194cd3122fc675c77fc4ac3d4ff0fd1a34/node_modules/concat-stream/", {"name":"concat-stream","reference":"1.6.2"}],
  ["../../Library/Caches/Yarn/v4/npm-typedarray-0.0.6-867ac74e3864187b1d3d47d996a78ec5c8830777/node_modules/typedarray/", {"name":"typedarray","reference":"0.0.6"}],
  ["../../Library/Caches/Yarn/v4/npm-console-browserify-1.1.0-f0241c45730a9fc6323b206dbf38edc741d0bb10/node_modules/console-browserify/", {"name":"console-browserify","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-date-now-0.1.4-eaf439fd4d4848ad74e5cc7dbef200672b9e345b/node_modules/date-now/", {"name":"date-now","reference":"0.1.4"}],
  ["../../Library/Caches/Yarn/v4/npm-constants-browserify-1.0.0-c20b96d8c617748aaf1c16021760cd27fcb8cb75/node_modules/constants-browserify/", {"name":"constants-browserify","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-crypto-browserify-3.12.0-396cf9f3137f03e4b8e532c58f698254e00f80ec/node_modules/crypto-browserify/", {"name":"crypto-browserify","reference":"3.12.0"}],
  ["../../Library/Caches/Yarn/v4/npm-browserify-cipher-1.0.1-8d6474c1b870bfdabcd3bcfcc1934a10e94f15f0/node_modules/browserify-cipher/", {"name":"browserify-cipher","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-browserify-aes-1.2.0-326734642f403dabc3003209853bb70ad428ef48/node_modules/browserify-aes/", {"name":"browserify-aes","reference":"1.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-buffer-xor-1.0.3-26e61ed1422fb70dd42e6e36729ed51d855fe8d9/node_modules/buffer-xor/", {"name":"buffer-xor","reference":"1.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-cipher-base-1.0.4-8760e4ecc272f4c363532f926d874aae2c1397de/node_modules/cipher-base/", {"name":"cipher-base","reference":"1.0.4"}],
  ["../../Library/Caches/Yarn/v4/npm-create-hash-1.2.0-889078af11a63756bcfb59bd221996be3a9ef196/node_modules/create-hash/", {"name":"create-hash","reference":"1.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-md5-js-1.3.5-b5d07b8e3216e3e27cd728d72f70d1e6a342005f/node_modules/md5.js/", {"name":"md5.js","reference":"1.3.5"}],
  ["../../Library/Caches/Yarn/v4/npm-hash-base-3.0.4-5fc8686847ecd73499403319a6b0a3f3f6ae4918/node_modules/hash-base/", {"name":"hash-base","reference":"3.0.4"}],
  ["../../Library/Caches/Yarn/v4/npm-ripemd160-2.0.2-a1c1a6f624751577ba5d07914cbc92850585890c/node_modules/ripemd160/", {"name":"ripemd160","reference":"2.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-sha-js-2.4.11-37a5cf0b81ecbc6943de109ba2960d1b26584ae7/node_modules/sha.js/", {"name":"sha.js","reference":"2.4.11"}],
  ["../../Library/Caches/Yarn/v4/npm-evp-bytestokey-1.0.3-7fcbdb198dc71959432efe13842684e0525acb02/node_modules/evp_bytestokey/", {"name":"evp_bytestokey","reference":"1.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-browserify-des-1.0.2-3af4f1f59839403572f1c66204375f7a7f703e9c/node_modules/browserify-des/", {"name":"browserify-des","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-des-js-1.0.0-c074d2e2aa6a8a9a07dbd61f9a15c2cd83ec8ecc/node_modules/des.js/", {"name":"des.js","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-minimalistic-assert-1.0.1-2e194de044626d4a10e7f7fbc00ce73e83e4d5c7/node_modules/minimalistic-assert/", {"name":"minimalistic-assert","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-browserify-sign-4.0.4-aa4eb68e5d7b658baa6bf6a57e630cbd7a93d298/node_modules/browserify-sign/", {"name":"browserify-sign","reference":"4.0.4"}],
  ["../../Library/Caches/Yarn/v4/npm-bn-js-4.11.8-2cde09eb5ee341f484746bb0309b3253b1b1442f/node_modules/bn.js/", {"name":"bn.js","reference":"4.11.8"}],
  ["../../Library/Caches/Yarn/v4/npm-browserify-rsa-4.0.1-21e0abfaf6f2029cf2fafb133567a701d4135524/node_modules/browserify-rsa/", {"name":"browserify-rsa","reference":"4.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-randombytes-2.1.0-df6f84372f0270dc65cdf6291349ab7a473d4f2a/node_modules/randombytes/", {"name":"randombytes","reference":"2.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-create-hmac-1.1.7-69170c78b3ab957147b2b8b04572e47ead2243ff/node_modules/create-hmac/", {"name":"create-hmac","reference":"1.1.7"}],
  ["../../Library/Caches/Yarn/v4/npm-elliptic-6.5.1-c380f5f909bf1b9b4428d028cd18d3b0efd6b52b/node_modules/elliptic/", {"name":"elliptic","reference":"6.5.1"}],
  ["../../Library/Caches/Yarn/v4/npm-brorand-1.1.0-12c25efe40a45e3c323eb8675a0a0ce57b22371f/node_modules/brorand/", {"name":"brorand","reference":"1.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-hash-js-1.1.7-0babca538e8d4ee4a0f8988d68866537a003cf42/node_modules/hash.js/", {"name":"hash.js","reference":"1.1.7"}],
  ["../../Library/Caches/Yarn/v4/npm-hmac-drbg-1.0.1-d2745701025a6c775a6c545793ed502fc0c649a1/node_modules/hmac-drbg/", {"name":"hmac-drbg","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-minimalistic-crypto-utils-1.0.1-f6c00c1c0b082246e5c4d99dfb8c7c083b2b582a/node_modules/minimalistic-crypto-utils/", {"name":"minimalistic-crypto-utils","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-parse-asn1-5.1.5-003271343da58dc94cace494faef3d2147ecea0e/node_modules/parse-asn1/", {"name":"parse-asn1","reference":"5.1.5"}],
  ["../../Library/Caches/Yarn/v4/npm-asn1-js-4.10.1-b9c2bf5805f1e64aadeed6df3a2bfafb5a73f5a0/node_modules/asn1.js/", {"name":"asn1.js","reference":"4.10.1"}],
  ["../../Library/Caches/Yarn/v4/npm-pbkdf2-3.0.17-976c206530617b14ebb32114239f7b09336e93a6/node_modules/pbkdf2/", {"name":"pbkdf2","reference":"3.0.17"}],
  ["../../Library/Caches/Yarn/v4/npm-create-ecdh-4.0.3-c9111b6f33045c4697f144787f9254cdc77c45ff/node_modules/create-ecdh/", {"name":"create-ecdh","reference":"4.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-diffie-hellman-5.0.3-40e8ee98f55a2149607146921c63e1ae5f3d2875/node_modules/diffie-hellman/", {"name":"diffie-hellman","reference":"5.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-miller-rabin-4.0.1-f080351c865b0dc562a8462966daa53543c78a4d/node_modules/miller-rabin/", {"name":"miller-rabin","reference":"4.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-public-encrypt-4.0.3-4fcc9d77a07e48ba7527e7cbe0de33d0701331e0/node_modules/public-encrypt/", {"name":"public-encrypt","reference":"4.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-randomfill-1.0.4-c92196fc86ab42be983f1bf31778224931d61458/node_modules/randomfill/", {"name":"randomfill","reference":"1.0.4"}],
  ["../../Library/Caches/Yarn/v4/npm-deps-sort-2.0.0-091724902e84658260eb910748cccd1af6e21fb5/node_modules/deps-sort/", {"name":"deps-sort","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-shasum-1.0.2-e7012310d8f417f4deb5712150e5678b87ae565f/node_modules/shasum/", {"name":"shasum","reference":"1.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-json-stable-stringify-0.0.1-611c23e814db375527df851193db59dd2af27f45/node_modules/json-stable-stringify/", {"name":"json-stable-stringify","reference":"0.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-subarg-1.0.0-f62cf17581e996b48fc965699f54c06ae268b8d2/node_modules/subarg/", {"name":"subarg","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-domain-browser-1.1.7-867aa4b093faa05f1de08c06f4d7b21fdf8698bc/node_modules/domain-browser/", {"name":"domain-browser","reference":"1.1.7"}],
  ["../../Library/Caches/Yarn/v4/npm-duplexer2-0.1.4-8b12dab878c0d69e3e7891051662a32fc6bddcc1/node_modules/duplexer2/", {"name":"duplexer2","reference":"0.1.4"}],
  ["../../Library/Caches/Yarn/v4/npm-events-1.1.1-9ebdb7635ad099c70dcc4c2a1f5004288e8bd924/node_modules/events/", {"name":"events","reference":"1.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-has-1.0.3-722d7cbfc1f6aa8241f16dd814e011e1f41e8796/node_modules/has/", {"name":"has","reference":"1.0.3"}],
  ["../../Library/Caches/Yarn/v4/npm-function-bind-1.1.1-a56899d3ea3c9bab874bb9773b7c5ede92f4895d/node_modules/function-bind/", {"name":"function-bind","reference":"1.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-htmlescape-1.1.1-3a03edc2214bca3b66424a3e7959349509cb0351/node_modules/htmlescape/", {"name":"htmlescape","reference":"1.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-https-browserify-0.0.1-3f91365cabe60b77ed0ebba24b454e3e09d95a82/node_modules/https-browserify/", {"name":"https-browserify","reference":"0.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-insert-module-globals-7.2.0-ec87e5b42728479e327bd5c5c71611ddfb4752ba/node_modules/insert-module-globals/", {"name":"insert-module-globals","reference":"7.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-acorn-node-1.8.2-114c95d64539e53dede23de8b9d96df7c7ae2af8/node_modules/acorn-node/", {"name":"acorn-node","reference":"1.8.2"}],
  ["../../Library/Caches/Yarn/v4/npm-acorn-7.1.0-949d36f2c292535da602283586c2477c57eb2d6c/node_modules/acorn/", {"name":"acorn","reference":"7.1.0"}],
  ["../../Library/Caches/Yarn/v4/npm-acorn-5.7.3-67aa231bf8812974b85235a96771eb6bd07ea279/node_modules/acorn/", {"name":"acorn","reference":"5.7.3"}],
  ["../../Library/Caches/Yarn/v4/npm-acorn-walk-7.0.0-c8ba6f0f1aac4b0a9e32d1f0af12be769528f36b/node_modules/acorn-walk/", {"name":"acorn-walk","reference":"7.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-buffer-from-1.1.1-32713bc028f75c02fdb710d7c7bcec1f2c6070ef/node_modules/buffer-from/", {"name":"buffer-from","reference":"1.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-process-0.11.10-7332300e840161bda3e69a1d1d91a7d4bc16f182/node_modules/process/", {"name":"process","reference":"0.11.10"}],
  ["../../Library/Caches/Yarn/v4/npm-undeclared-identifiers-1.1.3-9254c1d37bdac0ac2b52de4b6722792d2a91e30f/node_modules/undeclared-identifiers/", {"name":"undeclared-identifiers","reference":"1.1.3"}],
  ["../../Library/Caches/Yarn/v4/npm-dash-ast-1.0.0-12029ba5fb2f8aa6f0a861795b23c1b4b6c27d37/node_modules/dash-ast/", {"name":"dash-ast","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-get-assigned-identifiers-1.2.0-6dbf411de648cbaf8d9169ebb0d2d576191e2ff1/node_modules/get-assigned-identifiers/", {"name":"get-assigned-identifiers","reference":"1.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-simple-concat-1.0.0-7344cbb8b6e26fb27d66b2fc86f9f6d5997521c6/node_modules/simple-concat/", {"name":"simple-concat","reference":"1.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-labeled-stream-splicer-2.0.2-42a41a16abcd46fd046306cf4f2c3576fffb1c21/node_modules/labeled-stream-splicer/", {"name":"labeled-stream-splicer","reference":"2.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-stream-splicer-2.0.1-0b13b7ee2b5ac7e0609a7463d83899589a363fcd/node_modules/stream-splicer/", {"name":"stream-splicer","reference":"2.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-module-deps-4.1.1-23215833f1da13fd606ccb8087b44852dcb821fd/node_modules/module-deps/", {"name":"module-deps","reference":"4.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-detective-4.7.1-0eca7314338442febb6d65da54c10bb1c82b246e/node_modules/detective/", {"name":"detective","reference":"4.7.1"}],
  ["../../Library/Caches/Yarn/v4/npm-parents-1.0.1-fedd4d2bf193a77745fe71e371d73c3307d9c751/node_modules/parents/", {"name":"parents","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-path-platform-0.11.15-e864217f74c36850f0852b78dc7bf7d4a5721bf2/node_modules/path-platform/", {"name":"path-platform","reference":"0.11.15"}],
  ["../../Library/Caches/Yarn/v4/npm-stream-combiner2-1.1.1-fb4d8a1420ea362764e21ad4780397bebcb41cbe/node_modules/stream-combiner2/", {"name":"stream-combiner2","reference":"1.1.1"}],
  ["../../Library/Caches/Yarn/v4/npm-os-browserify-0.1.2-49ca0293e0b19590a5f5de10c7f265a617d8fe54/node_modules/os-browserify/", {"name":"os-browserify","reference":"0.1.2"}],
  ["../../Library/Caches/Yarn/v4/npm-path-browserify-0.0.1-e6c4ddd7ed3aa27c68a20cc4e50e1a4ee83bbc4a/node_modules/path-browserify/", {"name":"path-browserify","reference":"0.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-querystring-es3-0.2.1-9ec61f79049875707d69414596fd907a4d711e73/node_modules/querystring-es3/", {"name":"querystring-es3","reference":"0.2.1"}],
  ["../../Library/Caches/Yarn/v4/npm-read-only-stream-2.0.0-2724fd6a8113d73764ac288d4386270c1dbf17f0/node_modules/read-only-stream/", {"name":"read-only-stream","reference":"2.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-shell-quote-1.7.2-67a7d02c76c9da24f99d20808fcaded0e0e04be2/node_modules/shell-quote/", {"name":"shell-quote","reference":"1.7.2"}],
  ["../../Library/Caches/Yarn/v4/npm-stream-browserify-2.0.2-87521d38a44aa7ee91ce1cd2a47df0cb49dd660b/node_modules/stream-browserify/", {"name":"stream-browserify","reference":"2.0.2"}],
  ["../../Library/Caches/Yarn/v4/npm-stream-http-2.8.3-b2d242469288a5a27ec4fe8933acf623de6514fc/node_modules/stream-http/", {"name":"stream-http","reference":"2.8.3"}],
  ["../../Library/Caches/Yarn/v4/npm-builtin-status-codes-3.0.0-85982878e21b98e1c66425e03d0174788f569ee8/node_modules/builtin-status-codes/", {"name":"builtin-status-codes","reference":"3.0.0"}],
  ["../../Library/Caches/Yarn/v4/npm-to-arraybuffer-1.0.1-7d229b1fcc637e466ca081180836a7aabff83f43/node_modules/to-arraybuffer/", {"name":"to-arraybuffer","reference":"1.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-syntax-error-1.4.0-2d9d4ff5c064acb711594a3e3b95054ad51d907c/node_modules/syntax-error/", {"name":"syntax-error","reference":"1.4.0"}],
  ["../../Library/Caches/Yarn/v4/npm-timers-browserify-1.4.2-c9c58b575be8407375cb5e2462dacee74359f41d/node_modules/timers-browserify/", {"name":"timers-browserify","reference":"1.4.2"}],
  ["../../Library/Caches/Yarn/v4/npm-tty-browserify-0.0.1-3f05251ee17904dfd0677546670db9651682b811/node_modules/tty-browserify/", {"name":"tty-browserify","reference":"0.0.1"}],
  ["../../Library/Caches/Yarn/v4/npm-url-0.11.0-3838e97cfc60521eb73c525a8e55bfdd9e2e28f1/node_modules/url/", {"name":"url","reference":"0.11.0"}],
  ["../../Library/Caches/Yarn/v4/npm-querystring-0.2.0-b209849203bb25df820da756e747005878521620/node_modules/querystring/", {"name":"querystring","reference":"0.2.0"}],
  ["../../Library/Caches/Yarn/v4/npm-vm-browserify-0.0.4-5d7ea45bbef9e4a6ff65f95438e0a87c357d5a73/node_modules/vm-browserify/", {"name":"vm-browserify","reference":"0.0.4"}],
  ["../../Library/Caches/Yarn/v4/npm-indexof-0.0.1-82dc336d232b9062179d05ab3293a66059fd435d/node_modules/indexof/", {"name":"indexof","reference":"0.0.1"}],
  ["./", topLevelLocator],
]);
exports.findPackageLocator = function findPackageLocator(location) {
  let relativeLocation = normalizePath(path.relative(__dirname, location));

  if (!relativeLocation.match(isStrictRegExp))
    relativeLocation = `./${relativeLocation}`;

  if (location.match(isDirRegExp) && relativeLocation.charAt(relativeLocation.length - 1) !== '/')
    relativeLocation = `${relativeLocation}/`;

  let match;

  if (relativeLocation.length >= 151 && relativeLocation[150] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 151)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 147 && relativeLocation[146] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 147)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 145 && relativeLocation[144] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 145)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 143 && relativeLocation[142] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 143)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 141 && relativeLocation[140] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 141)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 139 && relativeLocation[138] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 139)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 137 && relativeLocation[136] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 137)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 135 && relativeLocation[134] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 135)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 133 && relativeLocation[132] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 133)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 132 && relativeLocation[131] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 132)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 131 && relativeLocation[130] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 131)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 130 && relativeLocation[129] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 130)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 129 && relativeLocation[128] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 129)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 128 && relativeLocation[127] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 128)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 127 && relativeLocation[126] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 127)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 126 && relativeLocation[125] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 126)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 125 && relativeLocation[124] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 125)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 124 && relativeLocation[123] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 124)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 123 && relativeLocation[122] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 123)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 121 && relativeLocation[120] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 121)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 120 && relativeLocation[119] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 120)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 119 && relativeLocation[118] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 119)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 117 && relativeLocation[116] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 117)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 116 && relativeLocation[115] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 116)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 115 && relativeLocation[114] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 115)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 114 && relativeLocation[113] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 114)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 113 && relativeLocation[112] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 113)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 112 && relativeLocation[111] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 112)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 111 && relativeLocation[110] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 111)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 110 && relativeLocation[109] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 110)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 109 && relativeLocation[108] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 109)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 108 && relativeLocation[107] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 108)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 107 && relativeLocation[106] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 107)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 106 && relativeLocation[105] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 106)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 105 && relativeLocation[104] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 105)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 104 && relativeLocation[103] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 104)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 103 && relativeLocation[102] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 103)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 102 && relativeLocation[101] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 102)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 101 && relativeLocation[100] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 101)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 100 && relativeLocation[99] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 100)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 99 && relativeLocation[98] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 99)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 2 && relativeLocation[1] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 2)))
      return blacklistCheck(match);

  return null;
};


/**
 * Returns the module that should be used to resolve require calls. It's usually the direct parent, except if we're
 * inside an eval expression.
 */

function getIssuerModule(parent) {
  let issuer = parent;

  while (issuer && (issuer.id === '[eval]' || issuer.id === '<repl>' || !issuer.filename)) {
    issuer = issuer.parent;
  }

  return issuer;
}

/**
 * Returns information about a package in a safe way (will throw if they cannot be retrieved)
 */

function getPackageInformationSafe(packageLocator) {
  const packageInformation = exports.getPackageInformation(packageLocator);

  if (!packageInformation) {
    throw makeError(
      `INTERNAL`,
      `Couldn't find a matching entry in the dependency tree for the specified parent (this is probably an internal error)`
    );
  }

  return packageInformation;
}

/**
 * Implements the node resolution for folder access and extension selection
 */

function applyNodeExtensionResolution(unqualifiedPath, {extensions}) {
  // We use this "infinite while" so that we can restart the process as long as we hit package folders
  while (true) {
    let stat;

    try {
      stat = statSync(unqualifiedPath);
    } catch (error) {}

    // If the file exists and is a file, we can stop right there

    if (stat && !stat.isDirectory()) {
      // If the very last component of the resolved path is a symlink to a file, we then resolve it to a file. We only
      // do this first the last component, and not the rest of the path! This allows us to support the case of bin
      // symlinks, where a symlink in "/xyz/pkg-name/.bin/bin-name" will point somewhere else (like "/xyz/pkg-name/index.js").
      // In such a case, we want relative requires to be resolved relative to "/xyz/pkg-name/" rather than "/xyz/pkg-name/.bin/".
      //
      // Also note that the reason we must use readlink on the last component (instead of realpath on the whole path)
      // is that we must preserve the other symlinks, in particular those used by pnp to deambiguate packages using
      // peer dependencies. For example, "/xyz/.pnp/local/pnp-01234569/.bin/bin-name" should see its relative requires
      // be resolved relative to "/xyz/.pnp/local/pnp-0123456789/" rather than "/xyz/pkg-with-peers/", because otherwise
      // we would lose the information that would tell us what are the dependencies of pkg-with-peers relative to its
      // ancestors.

      if (lstatSync(unqualifiedPath).isSymbolicLink()) {
        unqualifiedPath = path.normalize(path.resolve(path.dirname(unqualifiedPath), readlinkSync(unqualifiedPath)));
      }

      return unqualifiedPath;
    }

    // If the file is a directory, we must check if it contains a package.json with a "main" entry

    if (stat && stat.isDirectory()) {
      let pkgJson;

      try {
        pkgJson = JSON.parse(readFileSync(`${unqualifiedPath}/package.json`, 'utf-8'));
      } catch (error) {}

      let nextUnqualifiedPath;

      if (pkgJson && pkgJson.main) {
        nextUnqualifiedPath = path.resolve(unqualifiedPath, pkgJson.main);
      }

      // If the "main" field changed the path, we start again from this new location

      if (nextUnqualifiedPath && nextUnqualifiedPath !== unqualifiedPath) {
        const resolution = applyNodeExtensionResolution(nextUnqualifiedPath, {extensions});

        if (resolution !== null) {
          return resolution;
        }
      }
    }

    // Otherwise we check if we find a file that match one of the supported extensions

    const qualifiedPath = extensions
      .map(extension => {
        return `${unqualifiedPath}${extension}`;
      })
      .find(candidateFile => {
        return existsSync(candidateFile);
      });

    if (qualifiedPath) {
      return qualifiedPath;
    }

    // Otherwise, we check if the path is a folder - in such a case, we try to use its index

    if (stat && stat.isDirectory()) {
      const indexPath = extensions
        .map(extension => {
          return `${unqualifiedPath}/index${extension}`;
        })
        .find(candidateFile => {
          return existsSync(candidateFile);
        });

      if (indexPath) {
        return indexPath;
      }
    }

    // Otherwise there's nothing else we can do :(

    return null;
  }
}

/**
 * This function creates fake modules that can be used with the _resolveFilename function.
 * Ideally it would be nice to be able to avoid this, since it causes useless allocations
 * and cannot be cached efficiently (we recompute the nodeModulePaths every time).
 *
 * Fortunately, this should only affect the fallback, and there hopefully shouldn't be a
 * lot of them.
 */

function makeFakeModule(path) {
  const fakeModule = new Module(path, false);
  fakeModule.filename = path;
  fakeModule.paths = Module._nodeModulePaths(path);
  return fakeModule;
}

/**
 * Normalize path to posix format.
 */

function normalizePath(fsPath) {
  fsPath = path.normalize(fsPath);

  if (process.platform === 'win32') {
    fsPath = fsPath.replace(backwardSlashRegExp, '/');
  }

  return fsPath;
}

/**
 * Forward the resolution to the next resolver (usually the native one)
 */

function callNativeResolution(request, issuer) {
  if (issuer.endsWith('/')) {
    issuer += 'internal.js';
  }

  try {
    enableNativeHooks = false;

    // Since we would need to create a fake module anyway (to call _resolveLookupPath that
    // would give us the paths to give to _resolveFilename), we can as well not use
    // the {paths} option at all, since it internally makes _resolveFilename create another
    // fake module anyway.
    return Module._resolveFilename(request, makeFakeModule(issuer), false);
  } finally {
    enableNativeHooks = true;
  }
}

/**
 * This key indicates which version of the standard is implemented by this resolver. The `std` key is the
 * Plug'n'Play standard, and any other key are third-party extensions. Third-party extensions are not allowed
 * to override the standard, and can only offer new methods.
 *
 * If an new version of the Plug'n'Play standard is released and some extensions conflict with newly added
 * functions, they'll just have to fix the conflicts and bump their own version number.
 */

exports.VERSIONS = {std: 1};

/**
 * Useful when used together with getPackageInformation to fetch information about the top-level package.
 */

exports.topLevel = {name: null, reference: null};

/**
 * Gets the package information for a given locator. Returns null if they cannot be retrieved.
 */

exports.getPackageInformation = function getPackageInformation({name, reference}) {
  const packageInformationStore = packageInformationStores.get(name);

  if (!packageInformationStore) {
    return null;
  }

  const packageInformation = packageInformationStore.get(reference);

  if (!packageInformation) {
    return null;
  }

  return packageInformation;
};

/**
 * Transforms a request (what's typically passed as argument to the require function) into an unqualified path.
 * This path is called "unqualified" because it only changes the package name to the package location on the disk,
 * which means that the end result still cannot be directly accessed (for example, it doesn't try to resolve the
 * file extension, or to resolve directories to their "index.js" content). Use the "resolveUnqualified" function
 * to convert them to fully-qualified paths, or just use "resolveRequest" that do both operations in one go.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveToUnqualified = function resolveToUnqualified(request, issuer, {considerBuiltins = true} = {}) {
  // The 'pnpapi' request is reserved and will always return the path to the PnP file, from everywhere

  if (request === `pnpapi`) {
    return pnpFile;
  }

  // Bailout if the request is a native module

  if (considerBuiltins && builtinModules.has(request)) {
    return null;
  }

  // We allow disabling the pnp resolution for some subpaths. This is because some projects, often legacy,
  // contain multiple levels of dependencies (ie. a yarn.lock inside a subfolder of a yarn.lock). This is
  // typically solved using workspaces, but not all of them have been converted already.

  if (ignorePattern && ignorePattern.test(normalizePath(issuer))) {
    const result = callNativeResolution(request, issuer);

    if (result === false) {
      throw makeError(
        `BUILTIN_NODE_RESOLUTION_FAIL`,
        `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer was explicitely ignored by the regexp "null")`,
        {
          request,
          issuer,
        }
      );
    }

    return result;
  }

  let unqualifiedPath;

  // If the request is a relative or absolute path, we just return it normalized

  const dependencyNameMatch = request.match(pathRegExp);

  if (!dependencyNameMatch) {
    if (path.isAbsolute(request)) {
      unqualifiedPath = path.normalize(request);
    } else if (issuer.match(isDirRegExp)) {
      unqualifiedPath = path.normalize(path.resolve(issuer, request));
    } else {
      unqualifiedPath = path.normalize(path.resolve(path.dirname(issuer), request));
    }
  }

  // Things are more hairy if it's a package require - we then need to figure out which package is needed, and in
  // particular the exact version for the given location on the dependency tree

  if (dependencyNameMatch) {
    const [, dependencyName, subPath] = dependencyNameMatch;

    const issuerLocator = exports.findPackageLocator(issuer);

    // If the issuer file doesn't seem to be owned by a package managed through pnp, then we resort to using the next
    // resolution algorithm in the chain, usually the native Node resolution one

    if (!issuerLocator) {
      const result = callNativeResolution(request, issuer);

      if (result === false) {
        throw makeError(
          `BUILTIN_NODE_RESOLUTION_FAIL`,
          `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer doesn't seem to be part of the Yarn-managed dependency tree)`,
          {
            request,
            issuer,
          }
        );
      }

      return result;
    }

    const issuerInformation = getPackageInformationSafe(issuerLocator);

    // We obtain the dependency reference in regard to the package that request it

    let dependencyReference = issuerInformation.packageDependencies.get(dependencyName);

    // If we can't find it, we check if we can potentially load it from the packages that have been defined as potential fallbacks.
    // It's a bit of a hack, but it improves compatibility with the existing Node ecosystem. Hopefully we should eventually be able
    // to kill this logic and become stricter once pnp gets enough traction and the affected packages fix themselves.

    if (issuerLocator !== topLevelLocator) {
      for (let t = 0, T = fallbackLocators.length; dependencyReference === undefined && t < T; ++t) {
        const fallbackInformation = getPackageInformationSafe(fallbackLocators[t]);
        dependencyReference = fallbackInformation.packageDependencies.get(dependencyName);
      }
    }

    // If we can't find the path, and if the package making the request is the top-level, we can offer nicer error messages

    if (!dependencyReference) {
      if (dependencyReference === null) {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `You seem to be requiring a peer dependency ("${dependencyName}"), but it is not installed (which might be because you're the top-level package)`,
            {request, issuer, dependencyName}
          );
        } else {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" is trying to access a peer dependency ("${dependencyName}") that should be provided by its direct ancestor but isn't`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName}
          );
        }
      } else {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `You cannot require a package ("${dependencyName}") that is not declared in your dependencies (via "${issuer}")`,
            {request, issuer, dependencyName}
          );
        } else {
          const candidates = Array.from(issuerInformation.packageDependencies.keys());
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" (via "${issuer}") is trying to require the package "${dependencyName}" (via "${request}") without it being listed in its dependencies (${candidates.join(
              `, `
            )})`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName, candidates}
          );
        }
      }
    }

    // We need to check that the package exists on the filesystem, because it might not have been installed

    const dependencyLocator = {name: dependencyName, reference: dependencyReference};
    const dependencyInformation = exports.getPackageInformation(dependencyLocator);
    const dependencyLocation = path.resolve(__dirname, dependencyInformation.packageLocation);

    if (!dependencyLocation) {
      throw makeError(
        `MISSING_DEPENDENCY`,
        `Package "${dependencyLocator.name}@${dependencyLocator.reference}" is a valid dependency, but hasn't been installed and thus cannot be required (it might be caused if you install a partial tree, such as on production environments)`,
        {request, issuer, dependencyLocator: Object.assign({}, dependencyLocator)}
      );
    }

    // Now that we know which package we should resolve to, we only have to find out the file location

    if (subPath) {
      unqualifiedPath = path.resolve(dependencyLocation, subPath);
    } else {
      unqualifiedPath = dependencyLocation;
    }
  }

  return path.normalize(unqualifiedPath);
};

/**
 * Transforms an unqualified path into a qualified path by using the Node resolution algorithm (which automatically
 * appends ".js" / ".json", and transforms directory accesses into "index.js").
 */

exports.resolveUnqualified = function resolveUnqualified(
  unqualifiedPath,
  {extensions = Object.keys(Module._extensions)} = {}
) {
  const qualifiedPath = applyNodeExtensionResolution(unqualifiedPath, {extensions});

  if (qualifiedPath) {
    return path.normalize(qualifiedPath);
  } else {
    throw makeError(
      `QUALIFIED_PATH_RESOLUTION_FAILED`,
      `Couldn't find a suitable Node resolution for unqualified path "${unqualifiedPath}"`,
      {unqualifiedPath}
    );
  }
};

/**
 * Transforms a request into a fully qualified path.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveRequest = function resolveRequest(request, issuer, {considerBuiltins, extensions} = {}) {
  let unqualifiedPath;

  try {
    unqualifiedPath = exports.resolveToUnqualified(request, issuer, {considerBuiltins});
  } catch (originalError) {
    // If we get a BUILTIN_NODE_RESOLUTION_FAIL error there, it means that we've had to use the builtin node
    // resolution, which usually shouldn't happen. It might be because the user is trying to require something
    // from a path loaded through a symlink (which is not possible, because we need something normalized to
    // figure out which package is making the require call), so we try to make the same request using a fully
    // resolved issuer and throws a better and more actionable error if it works.
    if (originalError.code === `BUILTIN_NODE_RESOLUTION_FAIL`) {
      let realIssuer;

      try {
        realIssuer = realpathSync(issuer);
      } catch (error) {}

      if (realIssuer) {
        if (issuer.endsWith(`/`)) {
          realIssuer = realIssuer.replace(/\/?$/, `/`);
        }

        try {
          exports.resolveToUnqualified(request, realIssuer, {considerBuiltins});
        } catch (error) {
          // If an error was thrown, the problem doesn't seem to come from a path not being normalized, so we
          // can just throw the original error which was legit.
          throw originalError;
        }

        // If we reach this stage, it means that resolveToUnqualified didn't fail when using the fully resolved
        // file path, which is very likely caused by a module being invoked through Node with a path not being
        // correctly normalized (ie you should use "node $(realpath script.js)" instead of "node script.js").
        throw makeError(
          `SYMLINKED_PATH_DETECTED`,
          `A pnp module ("${request}") has been required from what seems to be a symlinked path ("${issuer}"). This is not possible, you must ensure that your modules are invoked through their fully resolved path on the filesystem (in this case "${realIssuer}").`,
          {
            request,
            issuer,
            realIssuer,
          }
        );
      }
    }
    throw originalError;
  }

  if (unqualifiedPath === null) {
    return null;
  }

  try {
    return exports.resolveUnqualified(unqualifiedPath, {extensions});
  } catch (resolutionError) {
    if (resolutionError.code === 'QUALIFIED_PATH_RESOLUTION_FAILED') {
      Object.assign(resolutionError.data, {request, issuer});
    }
    throw resolutionError;
  }
};

/**
 * Setups the hook into the Node environment.
 *
 * From this point on, any call to `require()` will go through the "resolveRequest" function, and the result will
 * be used as path of the file to load.
 */

exports.setup = function setup() {
  // A small note: we don't replace the cache here (and instead use the native one). This is an effort to not
  // break code similar to "delete require.cache[require.resolve(FOO)]", where FOO is a package located outside
  // of the Yarn dependency tree. In this case, we defer the load to the native loader. If we were to replace the
  // cache by our own, the native loader would populate its own cache, which wouldn't be exposed anymore, so the
  // delete call would be broken.

  const originalModuleLoad = Module._load;

  Module._load = function(request, parent, isMain) {
    if (!enableNativeHooks) {
      return originalModuleLoad.call(Module, request, parent, isMain);
    }

    // Builtins are managed by the regular Node loader

    if (builtinModules.has(request)) {
      try {
        enableNativeHooks = false;
        return originalModuleLoad.call(Module, request, parent, isMain);
      } finally {
        enableNativeHooks = true;
      }
    }

    // The 'pnpapi' name is reserved to return the PnP api currently in use by the program

    if (request === `pnpapi`) {
      return pnpModule.exports;
    }

    // Request `Module._resolveFilename` (ie. `resolveRequest`) to tell us which file we should load

    const modulePath = Module._resolveFilename(request, parent, isMain);

    // Check if the module has already been created for the given file

    const cacheEntry = Module._cache[modulePath];

    if (cacheEntry) {
      return cacheEntry.exports;
    }

    // Create a new module and store it into the cache

    const module = new Module(modulePath, parent);
    Module._cache[modulePath] = module;

    // The main module is exposed as global variable

    if (isMain) {
      process.mainModule = module;
      module.id = '.';
    }

    // Try to load the module, and remove it from the cache if it fails

    let hasThrown = true;

    try {
      module.load(modulePath);
      hasThrown = false;
    } finally {
      if (hasThrown) {
        delete Module._cache[modulePath];
      }
    }

    // Some modules might have to be patched for compatibility purposes

    for (const [filter, patchFn] of patchedModules) {
      if (filter.test(request)) {
        module.exports = patchFn(exports.findPackageLocator(parent.filename), module.exports);
      }
    }

    return module.exports;
  };

  const originalModuleResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function(request, parent, isMain, options) {
    if (!enableNativeHooks) {
      return originalModuleResolveFilename.call(Module, request, parent, isMain, options);
    }

    let issuers;

    if (options) {
      const optionNames = new Set(Object.keys(options));
      optionNames.delete('paths');

      if (optionNames.size > 0) {
        throw makeError(
          `UNSUPPORTED`,
          `Some options passed to require() aren't supported by PnP yet (${Array.from(optionNames).join(', ')})`
        );
      }

      if (options.paths) {
        issuers = options.paths.map(entry => `${path.normalize(entry)}/`);
      }
    }

    if (!issuers) {
      const issuerModule = getIssuerModule(parent);
      const issuer = issuerModule ? issuerModule.filename : `${process.cwd()}/`;

      issuers = [issuer];
    }

    let firstError;

    for (const issuer of issuers) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, issuer);
      } catch (error) {
        firstError = firstError || error;
        continue;
      }

      return resolution !== null ? resolution : request;
    }

    throw firstError;
  };

  const originalFindPath = Module._findPath;

  Module._findPath = function(request, paths, isMain) {
    if (!enableNativeHooks) {
      return originalFindPath.call(Module, request, paths, isMain);
    }

    for (const path of paths) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, path);
      } catch (error) {
        continue;
      }

      if (resolution) {
        return resolution;
      }
    }

    return false;
  };

  process.versions.pnp = String(exports.VERSIONS.std);
};

exports.setupCompatibilityLayer = () => {
  // ESLint currently doesn't have any portable way for shared configs to specify their own
  // plugins that should be used (https://github.com/eslint/eslint/issues/10125). This will
  // likely get fixed at some point, but it'll take time and in the meantime we'll just add
  // additional fallback entries for common shared configs.

  for (const name of [`react-scripts`]) {
    const packageInformationStore = packageInformationStores.get(name);
    if (packageInformationStore) {
      for (const reference of packageInformationStore.keys()) {
        fallbackLocators.push({name, reference});
      }
    }
  }

  // Modern versions of `resolve` support a specific entry point that custom resolvers can use
  // to inject a specific resolution logic without having to patch the whole package.
  //
  // Cf: https://github.com/browserify/resolve/pull/174

  patchedModules.push([
    /^\.\/normalize-options\.js$/,
    (issuer, normalizeOptions) => {
      if (!issuer || issuer.name !== 'resolve') {
        return normalizeOptions;
      }

      return (request, opts) => {
        opts = opts || {};

        if (opts.forceNodeResolution) {
          return opts;
        }

        opts.preserveSymlinks = true;
        opts.paths = function(request, basedir, getNodeModulesDir, opts) {
          // Extract the name of the package being requested (1=full name, 2=scope name, 3=local name)
          const parts = request.match(/^((?:(@[^\/]+)\/)?([^\/]+))/);

          // make sure that basedir ends with a slash
          if (basedir.charAt(basedir.length - 1) !== '/') {
            basedir = path.join(basedir, '/');
          }
          // This is guaranteed to return the path to the "package.json" file from the given package
          const manifestPath = exports.resolveToUnqualified(`${parts[1]}/package.json`, basedir);

          // The first dirname strips the package.json, the second strips the local named folder
          let nodeModules = path.dirname(path.dirname(manifestPath));

          // Strips the scope named folder if needed
          if (parts[2]) {
            nodeModules = path.dirname(nodeModules);
          }

          return [nodeModules];
        };

        return opts;
      };
    },
  ]);
};

if (module.parent && module.parent.id === 'internal/preload') {
  exports.setupCompatibilityLayer();

  exports.setup();
}

if (process.mainModule === module) {
  exports.setupCompatibilityLayer();

  const reportError = (code, message, data) => {
    process.stdout.write(`${JSON.stringify([{code, message, data}, null])}\n`);
  };

  const reportSuccess = resolution => {
    process.stdout.write(`${JSON.stringify([null, resolution])}\n`);
  };

  const processResolution = (request, issuer) => {
    try {
      reportSuccess(exports.resolveRequest(request, issuer));
    } catch (error) {
      reportError(error.code, error.message, error.data);
    }
  };

  const processRequest = data => {
    try {
      const [request, issuer] = JSON.parse(data);
      processResolution(request, issuer);
    } catch (error) {
      reportError(`INVALID_JSON`, error.message, error.data);
    }
  };

  if (process.argv.length > 2) {
    if (process.argv.length !== 4) {
      process.stderr.write(`Usage: ${process.argv[0]} ${process.argv[1]} <request> <issuer>\n`);
      process.exitCode = 64; /* EX_USAGE */
    } else {
      processResolution(process.argv[2], process.argv[3]);
    }
  } else {
    let buffer = '';
    const decoder = new StringDecoder.StringDecoder();

    process.stdin.on('data', chunk => {
      buffer += decoder.write(chunk);

      do {
        const index = buffer.indexOf('\n');
        if (index === -1) {
          break;
        }

        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);

        processRequest(line);
      } while (true);
    });
  }
}

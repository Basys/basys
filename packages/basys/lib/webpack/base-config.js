const fs = require('fs-extra');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const minimatch = require('minimatch');
const path = require('path');
const {VueLoaderPlugin} = require('vue-loader');
const webpack = require('webpack');
const {exit} = require('../utils');
const FrontendWebpackPlugin = require('./frontend-plugin');
const {generateLoaders} = require('./utils');

function getBabelLoader(config, entryType) {
  let targets;
  if (config.type === 'web') {
    if (entryType === 'backend') targets = {node: config.nodeVersion};
    if (entryType === 'frontend') targets = {browsers: config.browsers};
  }
  // BUG: use 'electron', 'ios', 'android' targets

  return {
    loader: 'babel-loader',
    options: {
      cacheDirectory: true,
      babelrc: false,
      presets: [
        [
          '@babel/preset-env',
          {
            modules: false,
            targets,
            useBuiltIns: 'entry',
          },
        ],
      ],
      plugins: [
        ...(config.type !== 'web' || entryType === 'frontend'
          ? [path.join(__dirname, 'babel-vue-plugin')]
          : []),
      ],
      // BUG: do we need it?
      // env: {
      //   testing: {
      //     plugins: ['istanbul'], // BUG: use with karma
      //     plugins: ['dynamic-import-node'], // BUG: use with jest
      //   },
      // },
    },
  };
}

module.exports = function(config, entryType) {
  const babelLoader = getBabelLoader(config, entryType);
  const assetsDir = path.join(config.projectDir, 'assets');
  const srcDir = path.join(config.projectDir, 'src');

  const jsRule = {
    test: /\.js$/,
    include: [
      srcDir,
      path.join(config.projectDir, '.basys'), // Required to apply loaders to webpack entries
    ],
    use: [babelLoader],
  };

  const moduleReplacementPlugin = new webpack.NormalModuleReplacementPlugin(/.*/, result => {
    for (const resourcePath in config.overrides) {
      const isMatch = path_ => path_ && minimatch(path_, resourcePath, {nocomment: true});
      if (isMatch(result.request)) {
        result.request = config.overrides[resourcePath];
      }
      if (isMatch(result.resource)) {
        result.resource = path.resolve(config.projectDir, config.overrides[resourcePath]);
      }
    }
  });

  if (config.type === 'web' && entryType === 'backend') {
    return {
      mode: config.env === 'dev' ? 'development' : 'production',
      context: config.projectDir,
      entry: path.join(config.tempDir, 'backend-entry.js'),
      target: 'node',
      output: {
        filename: 'backend.js',
        path: config.distDir,
      },
      resolve: {
        extensions: ['.js', '.json'],
        alias: {
          '@': assetsDir,
          '~': srcDir,
        },
      },
      module: {
        // BUG: think about processing backend-specific static files
        rules: [jsRule],
      },
      node: {
        // BUG: maybe set these values to true? `__dirname` is used in templates/backend.js and requires `false` value.
        __dirname: false,
        __filename: false,
      },
      externals: [
        function(context, request, callback) {
          // Don't bundle packages from node_modules into backend.js
          if (
            !request.startsWith('.') &&
            !request.startsWith('~') &&
            !request.startsWith('@') &&
            !path.isAbsolute(request)
          ) {
            return callback(null, `commonjs ${request}`);
          }
          callback();
        },
      ],
      plugins: [
        new webpack.DefinePlugin({
          'basys.env': JSON.stringify(config.env),
          'basys.appName': JSON.stringify(config.appName),
          'basys.entryType': "'backend'",
        }),
        moduleReplacementPlugin,
        // BUG: new webpack.BannerPlugin('require('source-map-support').install();', {raw: true, entryOnly: false}),
      ],
    };
  }

  if (entryType === 'frontend') {
    const assets = [path.join(config.tempDir, 'frontend-entry.js')];
    for (const relPath of config.styles) {
      const resolvePaths = [assetsDir].concat(require.resolve.paths(relPath));
      try {
        assets.push(require.resolve(relPath, {paths: resolvePaths}));
      } catch (e) {
        exit(e.message);
      }
    }

    if (config.env === 'dev') {
      assets.unshift(
        `webpack-dev-server/client/?http://${config.host}:${config.port}`,
        'webpack/hot/dev-server.js', // BUG: or use 'webpack/hot/only-dev-server.js'?
      );
    }

    const urlLoader = (extensions, dirName, limit) => ({
      test: new RegExp(`\\.(${extensions.join('|')})(\\?.*)?$`),
      use: [
        {
          loader: 'url-loader',
          options: {
            limit,
            name: `static/${dirName}/[name].[hash:7].[ext]`,
          },
        },
      ],
    });

    return {
      mode: config.env === 'dev' ? 'development' : 'production',
      context: config.projectDir,
      entry: {
        app: assets,
      },
      // BUG: Target should depend on app type, see https://webpack.js.org/configuration/target/ .
      //      See https://github.com/chentsulin/webpack-target-electron-renderer .
      target: 'web',
      output: {
        publicPath: config.assetsPublicPath,
      },
      resolve: {
        extensions: ['.js', '.json', '.vue'],
        alias: {
          '@': assetsDir,
          '~': srcDir,
        },
      },
      module: {
        rules: [
          jsRule,
          // CSS inside assets directory and .vue files are processed with PostCSS
          {
            test: /\.css$/,
            include: [assetsDir, srcDir],
            use: generateLoaders(config, 'css', true),
          },
          {
            test: /\.css$/,
            include: [/node_modules/],
            use: generateLoaders(config, 'css'),
          },
          {
            test: /\.less$/,
            include: [assetsDir, /node_modules/],
            use: generateLoaders(config, 'less'),
          },
          {
            test: /\.scss$/,
            include: [assetsDir, /node_modules/],
            use: generateLoaders(config, 'sass'),
          },
          {
            test: /\.pug$/,
            loader: 'pug-plain-loader',
          },
          {
            test: /\.vue$/,
            include: [srcDir],
            use: [
              {
                loader: 'vue-loader',
                options: {
                  transformAssetUrls: {
                    video: 'src',
                    source: 'src',
                    img: 'src',
                    image: 'xlink:href',
                  },
                },
              },
            ],
          },
          // BUG: allow to customize these extensions and limits in config?
          urlLoader(['png', 'jpg', 'jpeg', 'gif', 'svg'], 'img', 10000),
          urlLoader(['mp4', 'webm', 'ogg', 'mp3', 'wav', 'flac', 'aac'], 'media', 10000),
          urlLoader(['woff', 'woff2', 'eot', 'ttf', 'otf'], 'fonts', 10000),
        ],
      },
      plugins: [
        new webpack.DefinePlugin({
          'process.env': {
            NODE_ENV: JSON.stringify(process.env.NODE_ENV),
          },
          'basys.env': JSON.stringify(config.env),
          'basys.appName': JSON.stringify(config.appName),
          'basys.entryType': "'frontend'",
        }),
        new webpack.ProvidePlugin({
          // Make `Vue` object available in code without import
          Vue: ['vue/dist/vue.runtime.esm.js', 'default'],
        }),
        new VueLoaderPlugin(),
        moduleReplacementPlugin,
        new HtmlWebpackPlugin({
          filename: path.join(config.distDir, 'index.html'),
          template: fs.pathExistsSync(path.join(config.projectDir, 'index.html'))
            ? path.join(config.projectDir, 'index.html')
            : path.join(__dirname, '..', 'templates', 'index.html'),
          inject: 'body',
          minify:
            config.env !== 'dev'
              ? {
                  removeComments: true,
                  collapseWhitespace: true,
                  conservativeCollapse: true,
                  removeAttributeQuotes: true,
                  removeScriptTypeAttributes: true,
                  removeStyleLinkTypeAttributes: true,
                }
              : false,
        }),
        new FrontendWebpackPlugin(config),
      ],
      // BUG: think about it
      // node: {
      //   // prevent webpack from injecting useless setImmediate polyfill because Vue
      //   // source contains it (although only uses it if it's native).
      //   setImmediate: false,
      //   // prevent webpack from injecting mocks to Node native modules
      //   // that does not make sense for the client
      //   dgram: 'empty',
      //   fs: 'empty',
      //   net: 'empty',
      //   tls: 'empty',
      //   child_process: 'empty',
      // },
    };
  }
};

const path = require('path');

module.exports = {
  mode: 'development',
  entry: './src/comunica-browser.js',
  output: {
    filename: 'comunica-browser.js',
    path: path.resolve(__dirname, 'playground'),
  },
  resolve: {
    fallback: {
      url:    require.resolve('url/'),
      stream: require.resolve('stream-browserify'),
      buffer: require.resolve('buffer/'),
      // Comunica does not use these in-browser; stub them out
      fs:     false,
      path:   false,
      http:   false,
      https:  false,
      zlib:   false,
      crypto: false,
    },
  },
};

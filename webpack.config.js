const path = require('path');

module.exports = {
  // mode: 'development',
  mode: 'production',
  entry: './src/main.ts',
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.json$/,
        loader: 'json-loader',
        type: 'javascript/auto'
      },
      {
        test: /\.css$/i,
        rules: [
          {
            test: /\.css$/i,
            use: 'raw-loader',
          },
        ],
      },
      {
        test: /\.html$/i,
        use: 'raw-loader',
      },
      // {
      //   test: /\.css$/i,
      //   // use: ['style-loader', 'css-loader'],
      //   use: [
      //     'style-loader',
      //     {
      //       loader: 'css-loader',
      //       options: {
      //         modules: true,
      //         importLoaders: 1,
      //       },
      //     },
      //   ],
      // }
    ],
  },
  resolve: {
    extensions: ['.ts', '.js', '.json', '.css'],
    fallback: {
      events: require.resolve("events/"),
    },
  },
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
  },
  devtool: 'source-map',
  devServer: {
    contentBase: path.resolve(__dirname, 'dist'),
    compress: true,
    port: 8069,
  },
};

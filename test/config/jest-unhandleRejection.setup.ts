/* eslint-disable no-console */
process.on('unhandledRejection', (err) => {
  if (process.env.NODE_ENV === 'DEBUG') {
    console.warn(err);
  }
});

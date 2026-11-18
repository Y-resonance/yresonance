// The deployment config file. The yresonance Vite plugin resolves it to the project's file.
declare module 'yresonance:config' {
  const config: import('./config').PlatformConfig;
  export default config;
}

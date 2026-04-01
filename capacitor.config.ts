import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.peeap.chat",
  appName: "Peeap Chat",
  webDir: "out",
  server: {
    url: "https://chat.peeap.com",
    androidScheme: "https",
  },
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined,
    },
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: "#030712",
      showSpinner: false,
      androidSplashResourceName: "splash",
      splashFullScreen: false,
      splashImmersive: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#030712",
    },
  },
};

export default config;

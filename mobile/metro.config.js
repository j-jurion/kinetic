// Metro config: lets the app import the code shared with the web app (../packages/shared)
// as @kinetic/shared/…
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
const shared = path.resolve(__dirname, '../packages/shared/src')

config.watchFolders = [...(config.watchFolders ?? []), shared]
config.resolver.extraNodeModules = { ...config.resolver.extraNodeModules, '@kinetic/shared': shared }

module.exports = config

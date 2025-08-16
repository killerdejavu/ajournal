import fs from 'fs-extra';
import path from 'path';
import { defaultConfig } from './default.js';

class ConfigManager {
  constructor() {
    this.configPath = './config.json';
    this.config = null;
  }

  async load() {
    try {
      if (await fs.pathExists(this.configPath)) {
        const userConfig = await fs.readJson(this.configPath);
        this.config = this.mergeConfigs(defaultConfig, userConfig);
      } else {
        this.config = { ...defaultConfig };
        await this.save();
      }
      
      // Resolve environment variables in the config
      this.config = this.resolveEnvVariables(this.config);
    } catch (error) {
      console.error('Error loading config:', error.message);
      this.config = { ...defaultConfig };
      this.config = this.resolveEnvVariables(this.config);
    }
    return this.config;
  }

  async save() {
    try {
      await fs.ensureDir(path.dirname(this.configPath));
      await fs.writeJson(this.configPath, this.config, { spaces: 2 });
    } catch (error) {
      console.error('Error saving config:', error.message);
      throw error;
    }
  }

  get(key = null) {
    if (!this.config) {
      throw new Error('Config not loaded. Call load() first.');
    }
    
    if (!key) return this.config;
    
    return key.split('.').reduce((obj, k) => obj?.[k], this.config);
  }

  set(key, value) {
    if (!this.config) {
      throw new Error('Config not loaded. Call load() first.');
    }

    const keys = key.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((obj, k) => {
      if (!obj[k]) obj[k] = {};
      return obj[k];
    }, this.config);
    
    target[lastKey] = value;
  }

  mergeConfigs(defaultConf, userConf) {
    const result = { ...defaultConf };
    
    for (const key in userConf) {
      if (typeof userConf[key] === 'object' && !Array.isArray(userConf[key]) && userConf[key] !== null) {
        result[key] = this.mergeConfigs(defaultConf[key] || {}, userConf[key]);
      } else {
        result[key] = userConf[key];
      }
    }
    
    return result;
  }

  resolveEnvVariables(obj) {
    if (typeof obj === 'string') {
      // Replace ${ENV_VAR} with actual environment variable
      return obj.replace(/\$\{([^}]+)\}/g, (match, envVar) => {
        return process.env[envVar] || match;
      });
    } else if (Array.isArray(obj)) {
      return obj.map(item => this.resolveEnvVariables(item));
    } else if (typeof obj === 'object' && obj !== null) {
      const resolved = {};
      for (const [key, value] of Object.entries(obj)) {
        resolved[key] = this.resolveEnvVariables(value);
      }
      return resolved;
    }
    return obj;
  }

  async reset() {
    this.config = { ...defaultConfig };
    await this.save();
    return this.config;
  }
}

export default new ConfigManager();
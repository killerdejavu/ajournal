import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

// Import existing services
import ConfigManager from './config/config.js';
import StorageService from './services/storage.js';
import JournalService from './services/journal.js';
import { validateGCalTokenBeforeRun } from './utils/token-validator.js';
import { spawn } from 'child_process';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'web')));

// Initialize services
let config;
let storage;
let journalService;

async function initializeServices() {
  try {
    config = await ConfigManager.load();
    storage = new StorageService(config);
    journalService = new JournalService(config);
  } catch (error) {
    console.warn('Configuration not loaded:', error.message);
  }
}

// API Routes

// Get all journals
app.get('/api/journals', async (req, res) => {
  try {
    if (!storage) {
      return res.status(500).json({ error: 'Storage service not initialized' });
    }

    const journalsPath = path.join(process.cwd(), 'data/journals/daily');
    
    if (!await fs.pathExists(journalsPath)) {
      return res.json([]);
    }

    const journals = [];
    const years = await fs.readdir(journalsPath);
    
    for (const year of years) {
      if (!year.match(/^\d{4}$/)) continue;
      
      const yearPath = path.join(journalsPath, year);
      const weeks = await fs.readdir(yearPath);
      
      for (const week of weeks) {
        const weekPath = path.join(yearPath, week);
        const files = await fs.readdir(weekPath);
        
        for (const file of files) {
          if (file.endsWith('.md')) {
            const filePath = path.join(weekPath, file);
            const stats = await fs.stat(filePath);
            const content = await fs.readFile(filePath, 'utf-8');
            
            // Extract title from content
            const titleMatch = content.match(/^# (.+)$/m);
            const title = titleMatch ? titleMatch[1] : file.replace('.md', '');
            
            journals.push({
              id: file.replace('.md', ''),
              title,
              date: file.replace('.md', ''),
              path: filePath,
              size: stats.size,
              modified: stats.mtime,
              preview: content.substring(0, 200) + '...'
            });
          }
        }
      }
    }

    // Sort by date descending
    journals.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    res.json(journals);
  } catch (error) {
    console.error('Error fetching journals:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get specific journal
app.get('/api/journals/:date', async (req, res) => {
  try {
    const { date } = req.params;
    
    // Find journal file
    const journalsPath = path.join(process.cwd(), 'data/journals/daily');
    const year = date.split('-')[0];
    
    // Find the correct week folder
    const yearPath = path.join(journalsPath, year);
    if (!await fs.pathExists(yearPath)) {
      return res.status(404).json({ error: 'Journal not found' });
    }
    
    const weeks = await fs.readdir(yearPath);
    let journalPath = null;
    
    for (const week of weeks) {
      const weekPath = path.join(yearPath, week);
      const filePath = path.join(weekPath, `${date}.md`);
      
      if (await fs.pathExists(filePath)) {
        journalPath = filePath;
        break;
      }
    }
    
    if (!journalPath) {
      return res.status(404).json({ error: 'Journal not found' });
    }
    
    const content = await fs.readFile(journalPath, 'utf-8');
    const stats = await fs.stat(journalPath);
    
    res.json({
      id: date,
      date,
      content,
      path: journalPath,
      size: stats.size,
      modified: stats.mtime
    });
  } catch (error) {
    console.error('Error fetching journal:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update journal content
app.put('/api/journals/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const { content } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }
    
    // Find journal file
    const journalsPath = path.join(process.cwd(), 'data/journals/daily');
    const year = date.split('-')[0];
    const yearPath = path.join(journalsPath, year);
    
    if (!await fs.pathExists(yearPath)) {
      return res.status(404).json({ error: 'Journal not found' });
    }
    
    const weeks = await fs.readdir(yearPath);
    let journalPath = null;
    
    for (const week of weeks) {
      const weekPath = path.join(yearPath, week);
      const filePath = path.join(weekPath, `${date}.md`);
      
      if (await fs.pathExists(filePath)) {
        journalPath = filePath;
        break;
      }
    }
    
    if (!journalPath) {
      return res.status(404).json({ error: 'Journal not found' });
    }
    
    await fs.writeFile(journalPath, content, 'utf-8');
    const stats = await fs.stat(journalPath);
    
    res.json({
      id: date,
      date,
      content,
      size: stats.size,
      modified: stats.mtime,
      message: 'Journal updated successfully'
    });
  } catch (error) {
    console.error('Error updating journal:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get sync status
app.get('/api/status', async (req, res) => {
  try {
    const syncStatePath = path.join(process.cwd(), 'data/sync-state.json');
    
    if (!await fs.pathExists(syncStatePath)) {
      return res.json({ status: 'No sync data available' });
    }
    
    const syncState = await fs.readJSON(syncStatePath);
    res.json(syncState);
  } catch (error) {
    console.error('Error getting status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Trigger sync
app.post('/api/sync', async (req, res) => {
  try {
    const { integration, days } = req.body;
    
    let args = ['src/cli.js', 'sync'];
    
    if (integration) {
      args.push('--integration', integration);
    }
    
    if (days) {
      args.push('--days', days.toString());
    }
    
    const child = spawn('node', args, {
      cwd: process.cwd(),
      stdio: 'pipe'
    });
    
    let output = '';
    let errorOutput = '';
    
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        res.json({
          success: true,
          message: 'Sync completed successfully',
          output: output
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Sync failed',
          output: output,
          error: errorOutput
        });
      }
    });
    
  } catch (error) {
    console.error('Error running sync:', error);
    res.status(500).json({ error: error.message });
  }
});

// Run (sync + generate) - the main command
app.post('/api/run', async (req, res) => {
  try {
    const { days, startDate, endDate } = req.body;
    
    // Validate Google Calendar token before running
    console.log('🔍 Validating Google Calendar token...');
    const tokenValid = await validateGCalTokenBeforeRun();
    if (!tokenValid) {
      return res.status(400).json({
        success: false,
        message: 'Google Calendar token expired or invalid. Please refresh your token.',
        needsTokenRefresh: true
      });
    }
    
    let args = ['src/cli.js', 'run'];
    let actualDays = days;
    
    // Handle specific date range
    if (startDate) {
      const start = new Date(startDate + 'T00:00:00.000Z');
      const end = endDate ? new Date(endDate + 'T23:59:59.999Z') : new Date(startDate + 'T23:59:59.999Z');
      const today = new Date();
      
      // Ensure we don't sync future dates
      if (start > today) {
        return res.status(400).json({
          success: false,
          message: 'Cannot sync future dates'
        });
      }
      
      // For specific date ranges, calculate how many days to sync from today
      // to ensure we have all data for the requested date range
      const msPerDay = 1000 * 60 * 60 * 24;
      const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      
      // Days from today back to the start date
      const daysBackToStart = Math.ceil((todayStart - start) / msPerDay);
      
      // Ensure we sync at least enough days to cover the earliest requested date
      actualDays = Math.max(daysBackToStart + 1, 1);
    }
    
    if (actualDays && actualDays > 1) {
      // Use sync with days parameter for multi-day runs
      args = ['src/cli.js', 'sync', '--days', actualDays.toString()];
      
      const syncChild = spawn('node', args, {
        cwd: process.cwd(),
        stdio: 'pipe'
      });
      
      let output = '';
      let errorOutput = '';
      
      syncChild.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      syncChild.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      syncChild.on('close', async (code) => {
        if (code === 0) {
          // After sync, generate journals for the specific date range
          if (startDate && endDate) {
            // Generate for each date in the range
            await generateDateRange(startDate, endDate, output, errorOutput, res);
          } else if (startDate && !endDate) {
            // Single specific date
            const generateArgs = ['src/cli.js', 'generate', '--date', startDate];
            runGeneration(generateArgs, output, errorOutput, res);
          } else {
            // Recent days
            const generateArgs = ['src/cli.js', 'generate', '--range', actualDays.toString()];
            runGeneration(generateArgs, output, errorOutput, res);
          }
        } else {
          res.status(500).json({
            success: false,
            message: 'Sync failed',
            output: output,
            error: errorOutput
          });
        }
      });
    } else {
      // For single day, use the regular 'run' command
      const child = spawn('node', args, {
        cwd: process.cwd(),
        stdio: 'pipe'
      });
      
      let output = '';
      let errorOutput = '';
      
      child.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      child.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          res.json({
            success: true,
            message: 'Journal update completed',
            output: output
          });
        } else {
          res.status(500).json({
            success: false,
            message: 'Journal update failed',
            output: output,
            error: errorOutput
          });
        }
      });
    }
    
  } catch (error) {
    console.error('Error running journal update:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate journals
app.post('/api/generate', async (req, res) => {
  try {
    const { date, range } = req.body;
    
    let args = ['src/cli.js'];
    
    if (date) {
      args.push('generate', '--date', date);
    } else if (range) {
      args.push('generate', '--range', range.toString());
    } else {
      args.push('run');
    }
    
    const child = spawn('node', args, {
      cwd: process.cwd(),
      stdio: 'pipe'
    });
    
    let output = '';
    let errorOutput = '';
    
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        res.json({
          success: true,
          message: 'Journal generation completed',
          output: output
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Journal generation failed',
          output: output,
          error: errorOutput
        });
      }
    });
    
  } catch (error) {
    console.error('Error generating journals:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get configuration
app.get('/api/config', async (req, res) => {
  try {
    const configPath = path.join(process.cwd(), 'config.json');
    
    if (!await fs.pathExists(configPath)) {
      return res.status(404).json({ error: 'Config file not found' });
    }
    
    const config = await fs.readJSON(configPath);
    
    // Remove sensitive information
    const safeConfig = { ...config };
    delete safeConfig.jira?.password;
    
    res.json(safeConfig);
  } catch (error) {
    console.error('Error reading config:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update configuration
app.put('/api/config', async (req, res) => {
  try {
    const configPath = path.join(process.cwd(), 'config.json');
    const newConfig = req.body;
    
    await fs.writeJSON(configPath, newConfig, { spaces: 2 });
    
    res.json({
      message: 'Configuration updated successfully',
      config: newConfig
    });
  } catch (error) {
    console.error('Error updating config:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get environment variables status (without exposing actual values)
app.get('/api/env-status', (req, res) => {
  const envStatus = {
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    SLACK_BOT_TOKEN: !!process.env.SLACK_BOT_TOKEN,
    GITHUB_TOKEN: !!process.env.GITHUB_TOKEN,
    GOOGLE_CREDENTIALS_PATH: !!process.env.GOOGLE_CREDENTIALS_PATH,
    JIRA_API_TOKEN: !!process.env.JIRA_API_TOKEN
  };
  
  res.json(envStatus);
});

// Check Google Calendar token status and get refresh URL if needed
app.get('/api/gcal-token-status', async (req, res) => {
  try {
    const { TokenValidator } = await import('./utils/token-validator.js');
    const validator = new TokenValidator();
    const result = await validator.validateGoogleToken();
    
    if (!result.valid && result.needsRefresh) {
      // Generate refresh URL
      const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH;
      if (credentialsPath) {
        const credentials = await fs.readJson(credentialsPath);
        const { client_secret, client_id, redirect_uris } = 
          credentials.installed || credentials.web || credentials;
        
        const { google } = await import('googleapis');
        const redirectUri = redirect_uris?.[0] || 'urn:ietf:wg:oauth:2.0:oob';
        const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);
        
        const authUrl = oAuth2Client.generateAuthUrl({
          access_type: 'offline',
          scope: ['https://www.googleapis.com/auth/calendar.readonly'],
          prompt: 'consent'
        });
        
        res.json({
          valid: false,
          needsRefresh: true,
          authUrl: authUrl,
          message: 'Token expired. Please refresh using the provided URL.'
        });
      } else {
        res.json({
          valid: false,
          needsRefresh: false,
          error: 'Google credentials not configured'
        });
      }
    } else {
      res.json({
        valid: result.valid,
        needsRefresh: false,
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({
      valid: false,
      error: error.message
    });
  }
});

// Serve the web interface
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'index.html'));
});

// Start server
async function startServer() {
  await initializeServices();
  
  app.listen(PORT, () => {
    console.log(`🌐 AJournal Web UI running on http://localhost:${PORT}`);
    console.log('🚀 Open your browser to view and manage your journals!');
  });
}

// Helper function to generate journals for a date range
async function generateDateRange(startDate, endDate, output, errorOutput, res) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const dates = [];
  
  // Create array of dates to generate
  const current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  
  console.log(`Generating journals for date range: ${dates.join(', ')}`);
  output += `Generating journals for dates: ${dates.join(', ')}\n`;
  
  // Generate journals sequentially for each date
  let allSucceeded = true;
  for (const date of dates) {
    try {
      const result = await runGenerationPromise(['src/cli.js', 'generate', '--date', date]);
      output += result.output;
      if (result.error) {
        errorOutput += result.error;
      }
      if (!result.success) {
        allSucceeded = false;
      }
    } catch (error) {
      errorOutput += `Error generating journal for ${date}: ${error.message}\n`;
      allSucceeded = false;
    }
  }
  
  if (allSucceeded) {
    res.json({
      success: true,
      message: `Journals generated for ${dates.length} dates`,
      output: output
    });
  } else {
    res.status(500).json({
      success: false,
      message: 'Some journal generations failed',
      output: output,
      error: errorOutput
    });
  }
}

// Helper function to run generation command
function runGeneration(generateArgs, output, errorOutput, res) {
  const generateChild = spawn('node', generateArgs, {
    cwd: process.cwd(),
    stdio: 'pipe'
  });
  
  generateChild.stdout.on('data', (data) => {
    output += data.toString();
  });
  
  generateChild.stderr.on('data', (data) => {
    errorOutput += data.toString();
  });
  
  generateChild.on('close', (genCode) => {
    if (genCode === 0) {
      res.json({
        success: true,
        message: 'Journal update completed',
        output: output
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Journal generation failed',
        output: output,
        error: errorOutput
      });
    }
  });
}

// Helper function to run generation as a promise
function runGenerationPromise(generateArgs) {
  return new Promise((resolve) => {
    const child = spawn('node', generateArgs, {
      cwd: process.cwd(),
      stdio: 'pipe'
    });
    
    let output = '';
    let errorOutput = '';
    
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    child.on('close', (code) => {
      resolve({
        success: code === 0,
        output: output,
        error: errorOutput
      });
    });
  });
}

startServer().catch(console.error);

export default app;
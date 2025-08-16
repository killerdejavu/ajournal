#!/usr/bin/env node

import { google } from 'googleapis';
import fs from 'fs-extra';
import readline from 'readline';
import chalk from 'chalk';

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
const TOKEN_PATH = './data/google-token.json';

async function setupGoogleOAuth() {
  try {
    console.log(chalk.blue('🔧 Google Calendar OAuth Setup'));
    console.log('===============================\n');

    // Check if credentials file exists
    const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH;
    if (!credentialsPath) {
      console.log(chalk.red('❌ GOOGLE_CREDENTIALS_PATH not set in .env file'));
      console.log('Please add your Google credentials file path to .env');
      process.exit(1);
    }

    if (!(await fs.pathExists(credentialsPath))) {
      console.log(chalk.red(`❌ Credentials file not found at: ${credentialsPath}`));
      console.log('Please download your OAuth2 credentials from Google Cloud Console');
      process.exit(1);
    }

    // Load credentials
    const credentials = await fs.readJson(credentialsPath);
    console.log(chalk.green('✅ Found Google credentials file'));

    // Set up OAuth2 client
    const { client_secret, client_id, redirect_uris } = 
      credentials.installed || credentials.web || credentials;

    if (!client_secret || !client_id) {
      console.log(chalk.red('❌ Invalid credentials file format'));
      console.log('Expected OAuth2 credentials with client_id and client_secret');
      process.exit(1);
    }

    // For desktop applications, use the appropriate redirect URI
    let redirectUri = 'urn:ietf:wg:oauth:2.0:oob'; // Default for desktop apps
    
    if (redirect_uris && redirect_uris.length > 0) {
      // Use the first redirect URI if available
      redirectUri = redirect_uris[0];
    }

    console.log(chalk.blue(`Using redirect URI: ${redirectUri}`));

    const oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirectUri
    );

    // Check if we already have a token
    if (await fs.pathExists(TOKEN_PATH)) {
      console.log(chalk.yellow('⚠️  Existing token found'));
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise(resolve => {
        rl.question('Do you want to regenerate the token? (y/N): ', resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
        console.log(chalk.green('✅ Using existing token'));
        await testToken();
        return;
      }
    }

    // Generate authorization URL
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent', // Force consent to get refresh token
      response_type: 'code',
    });

    console.log(chalk.blue('\n🌐 Opening authorization URL in your browser...'));
    console.log(chalk.yellow('If it doesn\'t open automatically, copy and paste this URL:'));
    console.log(chalk.cyan(authUrl));

    // Try to open in browser
    try {
      const { default: open } = await import('open');
      await open(authUrl);
    } catch (error) {
      console.log(chalk.yellow('Could not open browser automatically'));
    }

    // Get authorization code from user
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const code = await new Promise(resolve => {
      console.log(chalk.blue('\n📋 After authorizing, you will get an authorization code.'));
      console.log(chalk.yellow('The code might appear:'));
      console.log(chalk.yellow('  • On a blank page in the URL (after "code=")'));
      console.log(chalk.yellow('  • On a success page showing the code'));
      console.log(chalk.yellow('  • In a text box you can copy from'));
      rl.question('Enter the authorization code here: ', resolve);
    });
    rl.close();

    // Exchange code for tokens
    console.log(chalk.blue('🔄 Exchanging code for tokens...'));
    try {
      // For desktop applications, we use getToken instead of getAccessToken
      const { tokens } = await oAuth2Client.getToken(code);
      
      if (!tokens) {
        throw new Error('No tokens received from Google OAuth');
      }
      
      console.log(chalk.green('✅ Tokens received successfully'));
    
      // Save tokens
      await fs.ensureDir('./data');
      await fs.writeJson(TOKEN_PATH, tokens, { spaces: 2 });
      
      console.log(chalk.green(`✅ Token saved to ${TOKEN_PATH}`));

      // Test the token
      await testToken();

      console.log(chalk.green('\n🎉 Google Calendar OAuth setup complete!'));
      console.log(chalk.blue('You can now run: node src/cli.js sync --integration gcal'));
      
    } catch (tokenError) {
      console.error(chalk.red('❌ Token exchange failed:'), tokenError.message);
      console.log(chalk.yellow('\n🔧 This is likely a redirect URI issue. Let me help you fix it:'));
      
      console.log(chalk.blue('\n1. Go to Google Cloud Console:'));
      console.log(chalk.cyan('   https://console.cloud.google.com/apis/credentials'));
      
      console.log(chalk.blue('\n2. Find your OAuth 2.0 Client ID and click edit'));
      
      console.log(chalk.blue('\n3. Under "Authorized redirect URIs", make sure you have:'));
      console.log(chalk.cyan('   http://localhost'));
      console.log(chalk.cyan('   http://localhost:3000'));
      console.log(chalk.cyan('   urn:ietf:wg:oauth:2.0:oob'));
      
      console.log(chalk.blue('\n4. Save the changes and try again'));
      
      throw tokenError;
    }

  } catch (error) {
    console.error(chalk.red('❌ Setup failed:'), error.message);
    process.exit(1);
  }
}

async function testToken() {
  try {
    console.log(chalk.blue('\n🧪 Testing Google Calendar access...'));
    
    const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH;
    const credentials = await fs.readJson(credentialsPath);
    
    const { client_secret, client_id, redirect_uris } = 
      credentials.installed || credentials.web || credentials;

    // For desktop applications, use the appropriate redirect URI
    let redirectUri = 'urn:ietf:wg:oauth:2.0:oob'; // Default for desktop apps
    
    if (redirect_uris && redirect_uris.length > 0) {
      redirectUri = redirect_uris[0];
    }

    const oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirectUri
    );

    const token = await fs.readJson(TOKEN_PATH);
    oAuth2Client.setCredentials(token);

    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

    // Test by getting calendar list
    const response = await calendar.calendarList.list();
    const calendars = response.data.items || [];

    console.log(chalk.green(`✅ Successfully connected! Found ${calendars.length} calendars:`));
    calendars.slice(0, 5).forEach(cal => {
      console.log(chalk.gray(`  - ${cal.summary}`));
    });

    if (calendars.length > 5) {
      console.log(chalk.gray(`  ... and ${calendars.length - 5} more`));
    }

  } catch (error) {
    console.log(chalk.red('❌ Token test failed:'), error.message);
    console.log(chalk.yellow('You may need to re-run the OAuth setup'));
  }
}

// Handle the script being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  // Load environment variables
  import('dotenv').then(({ default: dotenv }) => {
    dotenv.config();
    setupGoogleOAuth();
  });
}

export { setupGoogleOAuth };
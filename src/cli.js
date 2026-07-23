#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { subDays, addDays, addMonths, endOfDay, format, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, getMonth, getQuarter } from 'date-fns';

import configManager from './config/config.js';
import StorageService from './services/storage.js';
import SlackSearchIntegration from './integrations/slack-search.js';
import GitHubIntegration from './integrations/github.js';
import GCalIntegration from './integrations/gcal.js';
import JiraIntegration from './integrations/jira.js';
import AIService from './services/ai.js';
import JournalService from './services/journal.js';
import { validateGCalTokenBeforeRun } from './utils/token-validator.js';

dotenv.config();

const program = new Command();

program
  .name('ajournal')
  .description('Automated work journal generator with AI integration')
  .version('1.0.0');

program
  .command('sync')
  .description('Sync data from all configured integrations')
  .option('-d, --days <number>', 'Number of days to sync (default: from config)', parseInt)
  .option('-f, --from <date>', 'Sync from this date (YYYY-MM-DD); overrides --days')
  .option('-t, --to <date>', 'Sync up to this date inclusive (YYYY-MM-DD, default: today)')
  .option('-i, --integration <type>', 'Sync only specific integration (slack|github|gcal|jira)')
  .action(async (options) => {
    try {
      console.log(chalk.blue('🔄 Starting sync process...'));
      
      // Validate Google Calendar token if syncing gcal
      if (!options.integration || options.integration === 'gcal') {
        console.log(chalk.blue('🔍 Validating Google Calendar token...'));
        const tokenValid = await validateGCalTokenBeforeRun();
        if (!tokenValid) {
          console.log(chalk.red('❌ Google Calendar token validation failed. Please refresh your token.'));
          console.log(chalk.yellow('Run: node setup-google-oauth.js'));
          process.exit(1);
        }
      }
      
      const config = await configManager.load();
      const storage = new StorageService(config);
      await storage.init();
      
      const days = options.days || config.sync.lookbackDays;
      const startDate = options.from ? new Date(options.from) : subDays(new Date(), days);
      const endDate = options.to ? endOfDay(new Date(options.to)) : new Date();
      console.log(chalk.blue(`📅 Sync range: ${format(startDate, 'yyyy-MM-dd')} → ${format(endDate, 'yyyy-MM-dd')}`));

      const integrations = [];

      if (!options.integration || options.integration === 'slack') {
        if (config.integrations.slack.enabled) {
          integrations.push(new SlackSearchIntegration(config, storage));
        }
      }

      if (!options.integration || options.integration === 'github') {
        if (config.integrations.github.enabled) {
          integrations.push(new GitHubIntegration(config, storage));
        }
      }

      if (!options.integration || options.integration === 'gcal') {
        if (config.integrations.gcal.enabled) {
          integrations.push(new GCalIntegration(config, storage));
        }
      }

      if (!options.integration || options.integration === 'jira') {
        if (config.integrations.jira.enabled) {
          integrations.push(new JiraIntegration(config, storage));
        }
      }

      for (const integration of integrations) {
        console.log(chalk.yellow(`Syncing ${integration.name}...`));
        await integration.sync(startDate, endDate);
        console.log(chalk.green(`✅ ${integration.name} sync completed`));
      }

      console.log(chalk.green('✨ Sync process completed successfully!'));
    } catch (error) {
      console.error(chalk.red('❌ Sync failed:'), error.message);
      process.exit(1);
    }
  });

program
  .command('generate')
  .description('Generate journal entries using AI')
  .option('-d, --date <date>', 'Generate for specific date (YYYY-MM-DD)')
  .option('-r, --range <days>', 'Generate for last N days', parseInt)
  .option('-f, --from <date>', 'Generate for all dates from this date (YYYY-MM-DD)')
  .option('-t, --to <date>', 'Generate up to this date inclusive (YYYY-MM-DD, default: today)')
  .action(async (options) => {
    try {
      console.log(chalk.blue('📝 Generating journal entries...'));
      
      const config = await configManager.load();
      const storage = new StorageService(config);
      const aiService = new AIService(config);
      const journalService = new JournalService(config, storage, aiService);
      
      let dates = [];
      
      if (options.date) {
        dates = [new Date(options.date)];
      } else if (options.from) {
        const end = options.to ? new Date(options.to) : new Date();
        for (let d = new Date(options.from); d <= end; d = addDays(d, 1)) {
          dates.push(new Date(d));
        }
      } else if (options.range) {
        for (let i = 0; i < options.range; i++) {
          dates.push(subDays(new Date(), i));
        }
      } else {
        dates = [new Date()];
      }
      
      for (const date of dates) {
        console.log(chalk.yellow(`Generating journal for ${date.toDateString()}...`));
        const journalPath = await journalService.generate(date);
        console.log(chalk.green(`✅ Journal saved to: ${journalPath}`));
      }
      
      console.log(chalk.green('✨ Journal generation completed!'));
    } catch (error) {
      console.error(chalk.red('❌ Journal generation failed:'), error.message);
      process.exit(1);
    }
  });

program
  .command('config')
  .description('Manage configuration')
  .option('-s, --show', 'Show current configuration')
  .option('-r, --reset', 'Reset to default configuration')
  .option('--set <key=value>', 'Set configuration value')
  .action(async (options) => {
    try {
      const config = await configManager.load();
      
      if (options.show) {
        console.log(chalk.blue('Current Configuration:'));
        console.log(JSON.stringify(config, null, 2));
        return;
      }
      
      if (options.reset) {
        await configManager.reset();
        console.log(chalk.green('✅ Configuration reset to defaults'));
        return;
      }
      
      if (options.set) {
        const [key, value] = options.set.split('=');
        if (!key || value === undefined) {
          console.error(chalk.red('❌ Invalid format. Use: --set key=value'));
          return;
        }
        
        let parsedValue;
        try {
          parsedValue = JSON.parse(value);
        } catch {
          parsedValue = value;
        }
        
        configManager.set(key, parsedValue);
        await configManager.save();
        console.log(chalk.green(`✅ Set ${key} = ${JSON.stringify(parsedValue)}`));
        return;
      }
      
      console.log(chalk.yellow('Use --show, --reset, or --set key=value'));
    } catch (error) {
      console.error(chalk.red('❌ Config operation failed:'), error.message);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show sync status and recent activity')
  .action(async () => {
    try {
      const config = await configManager.load();
      const storage = new StorageService(config);
      
      const syncState = await storage.getSyncState();
      const journals = await storage.listJournals();
      
      console.log(chalk.blue('📊 AJournal Status'));
      console.log('==================');
      
      console.log(chalk.yellow('Sync Status:'));
      for (const [integration, state] of Object.entries(syncState)) {
        const lastSync = state.lastSync ? new Date(state.lastSync).toLocaleString() : 'Never';
        console.log(`  ${integration}: ${lastSync}`);
      }
      
      console.log(chalk.yellow('\nRecent Journals:'));
      for (const journal of journals.slice(0, 5)) {
        console.log(`  📄 ${journal}`);
      }
      
    } catch (error) {
      console.error(chalk.red('❌ Status check failed:'), error.message);
      process.exit(1);
    }
  });

program
  .command('run')
  .description('Sync data and generate journal entries in one command')
  .option('-d, --days <number>', 'Number of days to process (default: from config)', parseInt)
  .option('-i, --integration <type>', 'Sync only specific integration (slack|github|gcal|jira)')
  .action(async (options) => {
    try {
      console.log(chalk.blue('🚀 Running sync and generate...'));
      
      // Validate Google Calendar token before starting
      console.log(chalk.blue('🔍 Validating integrations...'));
      const tokenValid = await validateGCalTokenBeforeRun();
      if (!tokenValid) {
        console.log(chalk.red('❌ Token validation failed. Please refresh your Google Calendar token.'));
        console.log(chalk.yellow('Run: node setup-google-oauth.js'));
        process.exit(1);
      }
      
      const config = await configManager.load();
      const storage = new StorageService(config);
      await storage.init();
      
      const days = options.days || config.sync.lookbackDays;
      const startDate = subDays(new Date(), days);
      
      // Sync phase
      console.log(chalk.blue('🔄 Starting sync process...'));
      const integrations = [];
      
      if (!options.integration || options.integration === 'slack') {
        if (config.integrations.slack.enabled) {
          integrations.push(new SlackSearchIntegration(config, storage));
        }
      }
      
      if (!options.integration || options.integration === 'github') {
        if (config.integrations.github.enabled) {
          integrations.push(new GitHubIntegration(config, storage));
        }
      }
      
      if (!options.integration || options.integration === 'gcal') {
        if (config.integrations.gcal.enabled) {
          integrations.push(new GCalIntegration(config, storage));
        }
      }
      
      if (!options.integration || options.integration === 'jira') {
        if (config.integrations.jira.enabled) {
          integrations.push(new JiraIntegration(config, storage));
        }
      }
      
      for (const integration of integrations) {
        console.log(chalk.yellow(`Syncing ${integration.name}...`));
        await integration.sync(startDate, new Date());
        console.log(chalk.green(`✅ ${integration.name} sync completed`));
      }
      
      console.log(chalk.green('✨ Sync process completed!'));
      
      // Generate phase
      console.log(chalk.blue('📝 Generating journal entries...'));
      const aiService = new AIService(config);
      const journalService = new JournalService(config, storage, aiService);
      
      const dates = [];
      for (let i = 0; i < days; i++) {
        dates.push(subDays(new Date(), i));
      }
      
      for (const date of dates) {
        console.log(chalk.yellow(`Generating journal for ${date.toDateString()}...`));
        const journalPath = await journalService.generate(date);
        if (journalPath) {
          console.log(chalk.green(`✅ Journal saved to: ${journalPath}`));
        }
      }
      
      console.log(chalk.green('✨ Complete! Sync and journal generation finished successfully!'));
    } catch (error) {
      console.error(chalk.red('❌ Run command failed:'), error.message);
      process.exit(1);
    }
  });

program
  .command('weekly-report')
  .description('Generate a weekly report from existing journals')
  .option('-d, --date <date>', 'Start date for the week (YYYY-MM-DD, defaults to 7 days ago)')
  .option('-n, --name <name>', 'Custom name for the report file')
  .action(async (options) => {
    try {
      console.log(chalk.blue('📊 Generating weekly report...'));
      
      const config = await configManager.load();
      const storage = new StorageService(config);
      const aiService = new AIService(config);
      
      // Determine the week range
      let startDate, endDate;
      
      if (options.date) {
        startDate = new Date(options.date);
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6); // 7 days total (start + 6)
      } else {
        endDate = new Date();
        startDate = subDays(endDate, 6); // 7 days total (today - 6 previous days)
      }
      
      // Read all journals for the week
      const weeklyData = [];
      for (let i = 0; i < 7; i++) {
        const currentDate = new Date(startDate);
        currentDate.setDate(startDate.getDate() + i);
        
        try {
          const journal = await storage.getJournal(currentDate);
          if (journal) {
            weeklyData.push({
              date: currentDate,
              content: journal
            });
          }
        } catch (error) {
          console.log(chalk.yellow(`No journal found for ${currentDate.toDateString()}`));
        }
      }
      
      if (weeklyData.length === 0) {
        console.log(chalk.red('❌ No journals found for the specified week. Run sync and generate first.'));
        return;
      }
      
      console.log(chalk.green(`Found ${weeklyData.length} journal entries for the week`));
      
      // Generate weekly summary using AI
      const weeklyPrompt = `
Create a comprehensive weekly work summary based on these daily journal entries. Focus on:

1. **Key Accomplishments**: Major deliverables, milestones, and achievements
2. **Project Progress**: Status updates on ongoing initiatives
3. **Collaboration Highlights**: Important meetings, reviews, and team interactions
4. **Technical Insights**: Problems solved, optimizations made, lessons learned
5. **Time Allocation**: How time was distributed across different activities
6. **Blockers & Challenges**: Issues encountered and how they were addressed
7. **Next Week Planning**: Action items and follow-ups identified

Daily entries:
${weeklyData.map(entry => `=== ${format(entry.date, 'yyyy-MM-dd (EEEE)')} ===\n${entry.content}`).join('\n\n')}

Please provide a concise but comprehensive summary that would be valuable for team updates, performance reviews, and planning.
      `;
      
      console.log(chalk.yellow('Generating AI-powered weekly summary...'));
      const response = await aiService.client.messages.create({
        model: aiService.config.model,
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: weeklyPrompt
        }]
      });
      
      const weeklySummary = aiService.extractText(response);
      
      // Create weekly report
      const reportContent = `# Weekly Report - ${format(startDate, 'MMM dd')} to ${format(endDate, 'MMM dd, yyyy')}\n\n${weeklySummary}\n\n---\n*Generated on ${new Date().toISOString()} by AJournal*\n`;
      
      // Save weekly report
      const reportFileName = options.name || `weekly-report-${format(endDate, 'yyyy-MM-dd')}.md`;
      const reportPath = await storage.saveWeeklyReport(reportFileName, reportContent);
      
      console.log(chalk.green(`✨ Weekly report saved to: ${reportPath}`));
      
    } catch (error) {
      console.error(chalk.red('❌ Weekly report generation failed:'), error.message);
      process.exit(1);
    }
  });

program
  .command('monthly-report')
  .description('Generate a monthly report from existing journals')
  .option('-m, --month <month>', 'Month to generate report for (YYYY-MM, defaults to current month)')
  .option('-n, --name <name>', 'Custom name for the report file')
  .action(async (options) => {
    try {
      console.log(chalk.blue('📊 Generating monthly report...'));
      
      const config = await configManager.load();
      const storage = new StorageService(config);
      const aiService = new AIService(config);
      
      // Determine the month range
      let targetDate;
      if (options.month) {
        targetDate = new Date(options.month + '-01');
      } else {
        targetDate = new Date();
      }
      
      const startDate = startOfMonth(targetDate);
      const endDate = endOfMonth(targetDate);
      
      // Read all journals for the month
      const monthlyData = [];
      let currentDate = new Date(startDate);
      
      while (currentDate <= endDate) {
        try {
          const journal = await storage.getJournal(currentDate);
          if (journal) {
            monthlyData.push({
              date: new Date(currentDate),
              content: journal
            });
          }
        } catch (error) {
          console.log(chalk.yellow(`No journal found for ${currentDate.toDateString()}`));
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      if (monthlyData.length === 0) {
        console.log(chalk.red('❌ No journals found for the specified month. Run sync and generate first.'));
        return;
      }
      
      console.log(chalk.green(`Found ${monthlyData.length} journal entries for the month`));
      
      // Generate monthly summary using AI
      const monthlyPrompt = `
Create a comprehensive monthly work summary based on these daily journal entries. Focus on:

1. **Key Accomplishments**: Major deliverables, milestones, and achievements for the month
2. **Project Progress**: Status updates and progress on ongoing initiatives
3. **Collaboration & Leadership**: Important meetings, reviews, team interactions, and leadership activities
4. **Technical Growth**: Skills developed, problems solved, optimizations made, lessons learned
5. **Time Allocation**: How time was distributed across different activities and projects
6. **Challenges & Solutions**: Issues encountered and how they were addressed or resolved
7. **Goals & Planning**: Progress toward goals and planning for next month

Daily entries:
${monthlyData.map(entry => `=== ${format(entry.date, 'yyyy-MM-dd (EEEE)')} ===\n${entry.content}`).join('\n\n')}

Please provide a strategic monthly summary that would be valuable for performance reviews, goal setting, and career development.
      `;
      
      console.log(chalk.yellow('Generating AI-powered monthly summary...'));
      const response = await aiService.client.messages.create({
        model: aiService.config.model,
        max_tokens: 3000,
        messages: [{
          role: 'user',
          content: monthlyPrompt
        }]
      });
      
      const monthlySummary = aiService.extractText(response);
      
      // Create monthly report
      const monthName = format(targetDate, 'MMMM yyyy');
      const reportContent = `# Monthly Report - ${monthName}\n\n${monthlySummary}\n\n---\n*Generated on ${new Date().toISOString()} by AJournal*\n`;
      
      // Save monthly report
      const reportFileName = options.name || `monthly-report-${format(targetDate, 'yyyy-MM')}.md`;
      const reportPath = await storage.saveMonthlyReport(reportFileName, reportContent, targetDate);
      
      console.log(chalk.green(`✨ Monthly report saved to: ${reportPath}`));
      
    } catch (error) {
      console.error(chalk.red('❌ Monthly report generation failed:'), error.message);
      process.exit(1);
    }
  });

program
  .command('quarterly-report')
  .description('Generate a quarterly report from existing journals')
  .option('-q, --quarter <quarter>', 'Quarter to generate report for (YYYY-Q1/Q2/Q3/Q4, defaults to current quarter)')
  .option('-n, --name <name>', 'Custom name for the report file')
  .action(async (options) => {
    try {
      console.log(chalk.blue('📊 Generating quarterly report...'));
      
      const config = await configManager.load();
      const storage = new StorageService(config);
      const aiService = new AIService(config);
      
      // Determine the quarter range
      let targetDate;
      if (options.quarter) {
        const match = options.quarter.match(/^(\d{4})-Q([1-4])$/);
        if (match) {
          const year = parseInt(match[1]);
          const quarter = parseInt(match[2]);
          targetDate = new Date(year, (quarter - 1) * 3, 1);
        } else {
          throw new Error('Invalid quarter format. Use YYYY-Q1, YYYY-Q2, etc.');
        }
      } else {
        targetDate = new Date();
      }
      
      const startDate = startOfQuarter(targetDate);
      const endDate = endOfQuarter(targetDate);
      
      // Read all journals for the quarter
      const quarterlyData = [];
      let currentDate = new Date(startDate);
      
      while (currentDate <= endDate) {
        try {
          const journal = await storage.getJournal(currentDate);
          if (journal) {
            quarterlyData.push({
              date: new Date(currentDate),
              content: journal
            });
          }
        } catch (error) {
          // Silent fail for missing journals
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      if (quarterlyData.length === 0) {
        console.log(chalk.red('❌ No journals found for the specified quarter. Run sync and generate first.'));
        return;
      }
      
      console.log(chalk.green(`Found ${quarterlyData.length} journal entries for the quarter`));
      
      // Generate quarterly summary using AI
      const quarterlyPrompt = `
Create a comprehensive quarterly work summary based on these daily journal entries. Focus on:

1. **Strategic Accomplishments**: Major deliverables, business impact, and strategic initiatives completed
2. **Professional Growth**: Skills developed, leadership opportunities, career advancement
3. **Project Portfolio**: Overview of projects worked on, their outcomes, and business value
4. **Team & Collaboration**: Leadership activities, mentoring, cross-team collaborations
5. **Innovation & Problem Solving**: Creative solutions, process improvements, technical innovations
6. **Challenges & Resilience**: Major challenges overcome and lessons learned
7. **Strategic Planning**: Goals achieved and strategic directions for next quarter

Daily entries (${quarterlyData.length} days):
${quarterlyData.slice(0, 20).map(entry => `=== ${format(entry.date, 'yyyy-MM-dd')} ===\n${entry.content.substring(0, 500)}...`).join('\n\n')}

Please provide a high-level quarterly summary suitable for executive reviews, performance evaluations, and strategic planning.
      `;
      
      console.log(chalk.yellow('Generating AI-powered quarterly summary...'));
      const response = await aiService.client.messages.create({
        model: aiService.config.model,
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: quarterlyPrompt
        }]
      });
      
      const quarterlySummary = aiService.extractText(response);
      
      // Create quarterly report
      const quarterName = `Q${getQuarter(targetDate)} ${format(targetDate, 'yyyy')}`;
      const reportContent = `# Quarterly Report - ${quarterName}\n\n${quarterlySummary}\n\n---\n*Generated on ${new Date().toISOString()} by AJournal*\n`;
      
      // Save quarterly report
      const reportFileName = options.name || `quarterly-report-q${getQuarter(targetDate)}-${format(targetDate, 'yyyy')}.md`;
      const reportPath = await storage.saveQuarterlyReport(reportFileName, reportContent, targetDate);
      
      console.log(chalk.green(`✨ Quarterly report saved to: ${reportPath}`));
      
    } catch (error) {
      console.error(chalk.red('❌ Quarterly report generation failed:'), error.message);
      process.exit(1);
    }
  });

program
  .command('yearly-report')
  .description('Generate a yearly report (e.g. for annual appraisal) from monthly reports')
  .option('-f, --from <month>', 'First month of the period (YYYY-MM)')
  .option('-t, --to <month>', 'Last month of the period (YYYY-MM)')
  .option('-n, --name <name>', 'Custom name for the report file')
  .action(async (options) => {
    try {
      console.log(chalk.blue('📊 Generating yearly report...'));

      const config = await configManager.load();
      const storage = new StorageService(config);
      const aiService = new AIService(config);

      // Default period: the 12 full months ending last month
      let endMonth = options.to
        ? startOfMonth(new Date(options.to + '-01'))
        : startOfMonth(subDays(startOfMonth(new Date()), 1));
      let startMonth = options.from
        ? startOfMonth(new Date(options.from + '-01'))
        : addMonths(endMonth, -11);

      if (startMonth > endMonth) {
        throw new Error('--from month must not be after --to month');
      }

      const sections = [];
      const missing = [];
      for (let m = new Date(startMonth); m <= endMonth; m = addMonths(m, 1)) {
        const monthStr = format(m, 'yyyy-MM');
        const content = await storage.getReport('monthly', m, `monthly-report-${monthStr}.md`);
        if (content) {
          sections.push({ month: format(m, 'MMMM yyyy'), content });
        } else {
          missing.push(monthStr);
        }
      }

      if (missing.length > 0) {
        console.log(chalk.yellow(`⚠️ No monthly report found for: ${missing.join(', ')}`));
        console.log(chalk.yellow('   Run "ajournal monthly-report -m YYYY-MM" for those months for full coverage.'));
      }

      if (sections.length === 0) {
        console.log(chalk.red('❌ No monthly reports found for the period. Generate monthly reports first.'));
        return;
      }

      const periodLabel = `${format(startMonth, 'MMM yyyy')} – ${format(endMonth, 'MMM yyyy')}`;
      console.log(chalk.green(`Found ${sections.length} monthly reports for ${periodLabel}`));

      const yearlyPrompt = `
Create a comprehensive yearly work summary for an ANNUAL PERFORMANCE APPRAISAL, based on the monthly reports below. Focus on:

1. **Executive Summary**: 3-5 sentence overview of the year's contribution and impact
2. **Major Accomplishments**: The most significant deliverables and their business impact, roughly in order of importance
3. **Project Portfolio**: Each substantial project/initiative worked on, its outcome, and the person's role in it
4. **Technical Leadership & Growth**: Architecture decisions, hard problems solved, skills developed
5. **Collaboration & Influence**: Mentoring, reviews, cross-team work, communication highlights
6. **Process & Innovation**: Improvements to how the team works, tooling, automation
7. **Challenges Overcome**: Significant obstacles and how they were handled
8. **Metrics**: Any quantifiable measures across the year (PRs, reviews, tickets, meetings led) — aggregate them where the monthly reports include numbers
9. **Themes & Trajectory**: Patterns across the year showing growth and increasing scope

Be factual and specific — cite concrete projects, tickets, and outcomes from the reports. Avoid generic filler. Where months show a multi-month arc for one initiative, consolidate it into a single narrative.

Monthly reports (${sections.length} months, ${periodLabel}):
${sections.map(s => `=== ${s.month} ===\n${s.content}`).join('\n\n')}
      `;

      console.log(chalk.yellow('Generating AI-powered yearly summary...'));
      const response = await aiService.client.messages.create({
        model: aiService.config.model,
        max_tokens: 8000,
        messages: [{
          role: 'user',
          content: yearlyPrompt
        }]
      });

      const yearlySummary = aiService.extractText(response);

      const reportContent = `# Yearly Report - ${periodLabel}\n\n${yearlySummary}\n\n---\n*Generated on ${new Date().toISOString()} by AJournal from ${sections.length} monthly reports${missing.length ? ` (missing: ${missing.join(', ')})` : ''}*\n`;

      const reportFileName = options.name || `yearly-report-${format(startMonth, 'yyyy-MM')}-to-${format(endMonth, 'yyyy-MM')}.md`;
      const reportPath = await storage.saveYearlyReport(reportFileName, reportContent, endMonth);

      console.log(chalk.green(`✨ Yearly report saved to: ${reportPath}`));

    } catch (error) {
      console.error(chalk.red('❌ Yearly report generation failed:'), error.message);
      process.exit(1);
    }
  });

program
  .command('migrate')
  .description('Migrate existing journals to new folder structure')
  .action(async () => {
    try {
      console.log(chalk.blue('📁 Starting journal migration...'));
      
      const config = await configManager.load();
      const storage = new StorageService(config);
      
      const migrated = await storage.migrateExistingJournals();
      
      if (migrated > 0) {
        console.log(chalk.green(`✨ Successfully migrated ${migrated} files to new folder structure!`));
        console.log(chalk.yellow('📁 New structure:'));
        console.log('  data/journals/daily/YYYY/week-NN/YYYY-MM-DD.md');
        console.log('  data/journals/reports/weekly/YYYY/weekly-report-YYYY-MM-DD.md');
      } else {
        console.log(chalk.yellow('📁 No files needed migration.'));
      }
      
    } catch (error) {
      console.error(chalk.red('❌ Migration failed:'), error.message);
      process.exit(1);
    }
  });

program
  .command('setup')
  .description('Interactive setup wizard')
  .action(async () => {
    console.log(chalk.blue('🚀 AJournal Setup'));
    console.log('==================');
    console.log(chalk.yellow('Please ensure you have:'));
    console.log('1. Created a .env file with your API keys (see .env.example)');
    console.log('2. Configured integrations in config.json');
    console.log();
    console.log(chalk.green('Run "ajournal run" to sync data and generate journals'));
    console.log(chalk.green('Run "ajournal migrate" to move existing journals to new folder structure'));
    console.log(chalk.green('Run "ajournal weekly-report" to create weekly summaries'));
    console.log(chalk.green('Run "ajournal monthly-report" to create monthly summaries'));
    console.log(chalk.green('Run "ajournal quarterly-report" to create quarterly summaries'));
  });

program.parse();
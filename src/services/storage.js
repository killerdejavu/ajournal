import fs from 'fs-extra';
import path from 'path';
import { format, getWeek, getYear, getMonth, getQuarter } from 'date-fns';

class StorageService {
  constructor(config) {
    this.config = config;
    this.dataDir = config.storage.dataDir;
    this.syncStateFile = config.storage.syncStateFile;
    this.rawDataDir = config.storage.rawDataDir;
  }

  async init() {
    await fs.ensureDir(this.dataDir);
    await fs.ensureDir(this.rawDataDir);
    await fs.ensureDir(path.dirname(this.syncStateFile));
    await fs.ensureDir(this.config.journal.outputDir);
    
    // Initialize new folder structure
    await this.initJournalFolders();
  }

  async initJournalFolders() {
    const baseDir = this.config.journal.outputDir;
    
    // Create daily journals structure
    await fs.ensureDir(path.join(baseDir, 'daily'));
    
    // Create reports structure
    await fs.ensureDir(path.join(baseDir, 'reports', 'weekly'));
    await fs.ensureDir(path.join(baseDir, 'reports', 'monthly'));
    await fs.ensureDir(path.join(baseDir, 'reports', 'quarterly'));
  }

  getDailyJournalPath(date) {
    const year = getYear(date);
    const week = getWeek(date, { weekStartsOn: 1 }); // Monday start
    const weekFolder = `week-${week.toString().padStart(2, '0')}`;
    
    return path.join(
      this.config.journal.outputDir,
      'daily',
      year.toString(),
      weekFolder
    );
  }

  getReportPath(type, date, fileName) {
    const year = getYear(date);
    
    return path.join(
      this.config.journal.outputDir,
      'reports',
      type,
      year.toString(),
      fileName
    );
  }

  async getSyncState(integration = null) {
    try {
      const syncState = await fs.pathExists(this.syncStateFile) 
        ? await fs.readJson(this.syncStateFile)
        : {};
      
      if (integration) {
        return syncState[integration] || {};
      }
      
      return syncState;
    } catch (error) {
      console.error('Error reading sync state:', error.message);
      return integration ? {} : {};
    }
  }

  async setSyncState(integration, state) {
    try {
      const currentState = await this.getSyncState();
      currentState[integration] = {
        ...currentState[integration],
        ...state,
        lastSync: new Date().toISOString(),
      };
      
      await fs.writeJson(this.syncStateFile, currentState, { spaces: 2 });
      return currentState[integration];
    } catch (error) {
      console.error('Error writing sync state:', error.message);
      throw error;
    }
  }

  async saveRawData(integration, date, data) {
    try {
      const dateStr = format(new Date(date), 'yyyy-MM-dd');
      const integrationDir = path.join(this.rawDataDir, integration);
      await fs.ensureDir(integrationDir);
      
      const filePath = path.join(integrationDir, `${dateStr}.json`);
      
      let existingData = {};
      if (await fs.pathExists(filePath)) {
        existingData = await fs.readJson(filePath);
      }
      
      const mergedData = {
        ...existingData,
        timestamp: new Date().toISOString(),
        data: Array.isArray(data) ? data : [data],
      };
      
      await fs.writeJson(filePath, mergedData, { spaces: 2 });
      return filePath;
    } catch (error) {
      console.error('Error saving raw data:', error.message);
      throw error;
    }
  }

  async getRawData(integration, date) {
    try {
      const dateStr = format(new Date(date), 'yyyy-MM-dd');
      const filePath = path.join(this.rawDataDir, integration, `${dateStr}.json`);
      
      if (await fs.pathExists(filePath)) {
        return await fs.readJson(filePath);
      }
      
      return null;
    } catch (error) {
      console.error('Error reading raw data:', error.message);
      return null;
    }
  }

  async saveJournal(date, content) {
    try {
      const dateStr = format(new Date(date), this.config.journal.dateFormat);
      const fileName = `${dateStr}.md`;
      const journalDir = this.getDailyJournalPath(date);
      
      await fs.ensureDir(journalDir);
      const filePath = path.join(journalDir, fileName);
      
      await fs.writeFile(filePath, content, 'utf8');
      return filePath;
    } catch (error) {
      console.error('Error saving journal:', error.message);
      throw error;
    }
  }

  async getJournal(date) {
    try {
      const dateStr = format(new Date(date), this.config.journal.dateFormat);
      const fileName = `${dateStr}.md`;
      const journalDir = this.getDailyJournalPath(date);
      const filePath = path.join(journalDir, fileName);
      
      if (await fs.pathExists(filePath)) {
        return await fs.readFile(filePath, 'utf8');
      }
      
      // Fallback: check old location for backward compatibility
      const oldFilePath = path.join(this.config.journal.outputDir, fileName);
      if (await fs.pathExists(oldFilePath)) {
        return await fs.readFile(oldFilePath, 'utf8');
      }
      
      return null;
    } catch (error) {
      console.error('Error reading journal:', error.message);
      return null;
    }
  }

  async listJournals() {
    try {
      const journals = [];
      const dailyDir = path.join(this.config.journal.outputDir, 'daily');
      
      if (await fs.pathExists(dailyDir)) {
        const years = await fs.readdir(dailyDir);
        
        for (const year of years) {
          const yearPath = path.join(dailyDir, year);
          if ((await fs.stat(yearPath)).isDirectory()) {
            const weeks = await fs.readdir(yearPath);
            
            for (const week of weeks) {
              const weekPath = path.join(yearPath, week);
              if ((await fs.stat(weekPath)).isDirectory()) {
                const files = await fs.readdir(weekPath);
                const mdFiles = files
                  .filter(file => file.endsWith('.md'))
                  .map(file => `daily/${year}/${week}/${file}`);
                journals.push(...mdFiles);
              }
            }
          }
        }
      }
      
      // Also check old location for backward compatibility
      const oldFiles = await fs.readdir(this.config.journal.outputDir);
      const oldMdFiles = oldFiles
        .filter(file => file.endsWith('.md') && !file.startsWith('weekly-report'))
        .map(file => file);
      journals.push(...oldMdFiles);
      
      return journals.sort().reverse(); // Most recent first
    } catch (error) {
      console.error('Error listing journals:', error.message);
      return [];
    }
  }

  async saveReport(type, date, fileName, content) {
    try {
      const reportPath = this.getReportPath(type, date, fileName);
      await fs.ensureDir(path.dirname(reportPath));
      await fs.writeFile(reportPath, content, 'utf8');
      return reportPath;
    } catch (error) {
      console.error(`Error saving ${type} report:`, error.message);
      throw error;
    }
  }

  async saveWeeklyReport(fileName, content, date = new Date()) {
    return this.saveReport('weekly', date, fileName, content);
  }

  async saveMonthlyReport(fileName, content, date = new Date()) {
    return this.saveReport('monthly', date, fileName, content);
  }

  async saveQuarterlyReport(fileName, content, date = new Date()) {
    return this.saveReport('quarterly', date, fileName, content);
  }

  async getReportsForPeriod(type, year) {
    try {
      const reportDir = path.join(
        this.config.journal.outputDir,
        'reports',
        type,
        year.toString()
      );
      
      if (await fs.pathExists(reportDir)) {
        const files = await fs.readdir(reportDir);
        return files
          .filter(file => file.endsWith('.md'))
          .sort()
          .reverse();
      }
      
      return [];
    } catch (error) {
      console.error(`Error listing ${type} reports:`, error.message);
      return [];
    }
  }

  async migrateExistingJournals() {
    try {
      console.log('🔄 Migrating existing journals to new folder structure...');
      const baseDir = this.config.journal.outputDir;
      const files = await fs.readdir(baseDir);
      
      const journalFiles = files.filter(file => 
        file.endsWith('.md') && 
        file.match(/^\d{4}-\d{2}-\d{2}\.md$/) && // Daily journal format
        !file.startsWith('weekly-report-') &&
        !file.startsWith('monthly-report-') &&
        !file.startsWith('quarterly-report-')
      );
      
      let migrated = 0;
      
      for (const fileName of journalFiles) {
        try {
          const dateMatch = fileName.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
          if (dateMatch) {
            const date = new Date(dateMatch[1]);
            const newDir = this.getDailyJournalPath(date);
            
            await fs.ensureDir(newDir);
            
            const oldPath = path.join(baseDir, fileName);
            const newPath = path.join(newDir, fileName);
            
            await fs.move(oldPath, newPath);
            migrated++;
            console.log(`✅ Migrated ${fileName} to ${path.relative(baseDir, newPath)}`);
          }
        } catch (error) {
          console.error(`❌ Failed to migrate ${fileName}:`, error.message);
        }
      }

      // Move existing weekly reports to new reports structure
      const weeklyReports = files.filter(file => 
        file.startsWith('weekly-report-') && file.endsWith('.md')
      );
      
      for (const fileName of weeklyReports) {
        try {
          const dateMatch = fileName.match(/weekly-report-(\d{4}-\d{2}-\d{2})\.md$/);
          if (dateMatch) {
            const date = new Date(dateMatch[1]);
            const reportPath = this.getReportPath('weekly', date, fileName);
            
            await fs.ensureDir(path.dirname(reportPath));
            await fs.move(path.join(baseDir, fileName), reportPath);
            migrated++;
            console.log(`✅ Migrated ${fileName} to reports/weekly/`);
          }
        } catch (error) {
          console.error(`❌ Failed to migrate ${fileName}:`, error.message);
        }
      }
      
      console.log(`✨ Migration completed! Migrated ${migrated} files.`);
      return migrated;
    } catch (error) {
      console.error('Error during migration:', error.message);
      throw error;
    }
  }

  async getRawDataForDateRange(integration, startDate, endDate) {
    try {
      const integrationDir = path.join(this.rawDataDir, integration);
      
      if (!(await fs.pathExists(integrationDir))) {
        return {};
      }
      
      const files = await fs.readdir(integrationDir);
      const dataByDate = {};
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        const fileDate = file.replace('.json', '');
        const date = new Date(fileDate);
        
        if (date >= new Date(startDate) && date <= new Date(endDate)) {
          const filePath = path.join(integrationDir, file);
          dataByDate[fileDate] = await fs.readJson(filePath);
        }
      }
      
      return dataByDate;
    } catch (error) {
      console.error('Error getting raw data for date range:', error.message);
      return {};
    }
  }
}

export default StorageService;
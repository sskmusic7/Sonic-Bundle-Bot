const winston = require('winston');
const fs = require('fs');
const path = require('path');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Create logger with transports
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'sonic-flipper' },
  transports: [
    // Error log file
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5
    }),
    // Combined log file
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 10
    })
  ]
});

// Add console transport if enabled
if (process.env.NODE_ENV !== 'production' || process.env.LOG_CONSOLE !== 'false') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message, ...metadata }) => {
        let msg = `${timestamp} [${level}]: ${message}`;
        if (Object.keys(metadata).length > 0) {
          msg += ' ' + JSON.stringify(metadata);
        }
        return msg;
      })
    )
  }));
}

// Add search-specific log
const searchLog = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'searches.log'),
      maxsize: 10485760,
      maxFiles: 5
    })
  ]
});

// Add profit-specific log
const profitLog = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'profits.log'),
      maxsize: 10485760,
      maxFiles: 5
    })
  ]
});

// Helper functions
function logSearch(searchTerm, platform, resultsCount, duration) {
  searchLog.info({
    type: 'search',
    searchTerm,
    platform,
    resultsCount,
    duration
  });
}

function logProfit(item, analysis) {
  profitLog.info({
    type: 'profit_analysis',
    item: {
      title: item.title,
      price: item.price,
      platform: item.platform
    },
    analysis: {
      profitable: analysis.profitable,
      buyPrice: analysis.buyPrice,
      suggestedPrice: analysis.suggestedPrice,
      grossProfit: analysis.grossProfit,
      fees: analysis.fees,
      netProfit: analysis.netProfit,
      margin: analysis.margin
    }
  });
}

function logBundle(bundle) {
  profitLog.info({
    type: 'bundle',
    bundleName: bundle.bundleName,
    items: bundle.items.map(i => ({ title: i.title, price: i.price, platform: i.platform })),
    totalCost: bundle.totalCost,
    resaleValue: bundle.resaleValue,
    netProfit: bundle.netProfit,
    netMargin: bundle.netMargin,
    viable: bundle.viable
  });
}

module.exports = {
  logger,
  logSearch,
  logProfit,
  logBundle
};

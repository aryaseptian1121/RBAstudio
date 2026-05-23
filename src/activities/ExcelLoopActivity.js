const { createDefaultConfig } = require('../utils/excelLoopDefaults');

const ExcelLoopActivityDefinition = {
  sec: 'Data & Files',
  type: 'excel-loop',
  icon: '📊',
  label: 'Excel Loop',
  desc: 'Baca data Excel baris per baris dan jalankan automation browser',
  color: '#16a34a',
  bg: 'rgba(22,163,74,0.15)',
  defaultProperties: {
    name: 'Excel Loop',
    data: {
      excelConfig: createDefaultConfig(),
    },
  },
};

module.exports = { ExcelLoopActivityDefinition };

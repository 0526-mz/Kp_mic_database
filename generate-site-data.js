const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const BATCH_DIR = path.join(ROOT, "batch");
const REPORT_DIR = path.join(ROOT, "reports");
const OUTPUT_FILE = path.join(ROOT, "site-data.js");

const drugOrder = [
  "ATM",
  "CRO",
  "MEM",
  "LVX",
  "AMK",
  "POL",
  "TGC",
  "SXT",
  "CAZ-AVI",
  "ATM-AVI"
];

const batchMeta = {
  "0528_0529": {
    name: "0528-0529 OD600",
    wavelength: "OD600",
    background: "LB fixed background 0.049 was subtracted."
  },
  "0604": {
    name: "0604 OD630",
    wavelength: "OD630",
    background: "Per-plate blank mean was subtracted."
  },
  "0611": {
    name: "0611 OD630",
    wavelength: "OD630",
    background: "Per-plate blank mean was subtracted."
  }
};

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i++;
      }
      row.push(field);
      if (row.some(v => v.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some(v => v.trim() !== "")) {
      rows.push(row);
    }
  }

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(values => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] !== undefined ? values[idx].trim() : "";
    });
    return obj;
  });
}

function getValue(row, keys, fallback = "") {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== "") {
      return row[key];
    }
  }
  return fallback;
}

function inferBatchId(fileName) {
  return fileName.replace(/_mic_summary\.csv$/i, "");
}

function normalizeCurveFlag(value) {
  if (!value) return "ok";
  const v = String(value).toLowerCase().trim();

  if (["noisy", "noise", "bad", "warning", "warn", "1", "true", "yes"].includes(v)) {
    return "noisy";
  }

  return "ok";
}

function makeRecord(row, batchId) {
  const meta = batchMeta[batchId] || {
    name: batchId,
    wavelength: "",
    background: ""
  };

  const strain = getValue(row, [
    "strain",
    "Strain",
    "isolate",
    "Isolate",
    "sample",
    "Sample",
    "sample_id",
    "Sample_ID",
    "菌株",
    "菌株号",
    "样本号"
  ]);

  const drug = getValue(row, [
    "drug",
    "Drug",
    "antibiotic",
    "Antibiotic",
    "agent",
    "Agent",
    "药物",
    "抗生素"
  ]);

  const mic = getValue(row, [
    "mic",
    "MIC",
    "mic_result",
    "MIC_result",
    "MIC Result",
    "MIC结果"
  ]);

  const blankMean = getValue(row, [
    "blankMean",
    "blank_mean",
    "BlankMean",
    "blank",
    "Blank",
    "blank_mean_od",
    "空白均值"
  ]);

  const controlMean = getValue(row, [
    "controlMean",
    "control_mean",
    "ControlMean",
    "control",
    "Control",
    "positive_control",
    "阳性对照均值",
    "生长对照均值"
  ]);

  const curveFlag = normalizeCurveFlag(getValue(row, [
    "curveFlag",
    "curve_flag",
    "flag",
    "Flag",
    "quality",
    "Quality",
    "曲线标记"
  ], "ok"));

  const replicateCount = getValue(row, [
    "replicateCount",
    "replicate_count",
    "replicates",
    "Replicates",
    "n",
    "N",
    "重复数"
  ], "3");

  return {
    batch: batchId,
    batchName: meta.name,
    wavelength: meta.wavelength,
    strain,
    drug,
    mic,
    blankMean,
    controlMean,
    curveFlag,
    replicateCount,
    chartPath: `charts/${strain}__${drug}.svg`
  };
}

function main() {
  if (!fs.existsSync(BATCH_DIR)) {
    throw new Error("Cannot find batch directory.");
  }

  const csvFiles = fs
    .readdirSync(BATCH_DIR)
    .filter(file => file.endsWith("_mic_summary.csv"))
    .sort();

  const batches = [];
  const records = [];

  for (const file of csvFiles) {
    const batchId = inferBatchId(file);
    const meta = batchMeta[batchId] || {
      name: batchId,
      wavelength: "",
      background: ""
    };

    const csvPath = path.join(BATCH_DIR, file);
    const csvText = fs.readFileSync(csvPath, "utf8");
    const rows = parseCSV(csvText);

    const batchRecords = rows
      .map(row => makeRecord(row, batchId))
      .filter(record => record.strain && record.drug);

    const strains = new Set(batchRecords.map(record => record.strain));
    const noisyCount = batchRecords.filter(record => record.curveFlag === "noisy").length;

    const reportFile = `${batchId}_report.html`;
    const reportPath = path.join(REPORT_DIR, reportFile);

    batches.push({
      id: batchId,
      name: meta.name,
      resultDir: batchId,
      reportPath: fs.existsSync(reportPath) ? `reports/${reportFile}` : "",
      wavelength: meta.wavelength,
      background: meta.background,
      strainCount: strains.size,
      recordCount: batchRecords.length,
      noisyCount
    });

    records.push(...batchRecords);
  }

  records.sort((a, b) => {
    if (a.batch !== b.batch) return a.batch.localeCompare(b.batch);
    if (a.strain !== b.strain) return a.strain.localeCompare(b.strain);

    const drugA = drugOrder.indexOf(a.drug);
    const drugB = drugOrder.indexOf(b.drug);

    if (drugA !== -1 && drugB !== -1) return drugA - drugB;
    if (drugA !== -1) return -1;
    if (drugB !== -1) return 1;

    return a.drug.localeCompare(b.drug);
  });

  const data = {
    drugOrder,
    batches,
    records
  };

  const output = `window.MIC_DATA = ${JSON.stringify(data, null, 2)};\n`;

  fs.writeFileSync(OUTPUT_FILE, output, "utf8");

  console.log(`Generated site-data.js`);
  console.log(`Batches: ${batches.length}`);
  console.log(`Records: ${records.length}`);
}

main();

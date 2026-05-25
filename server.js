const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_FILE = path.join(__dirname, 'data', 'models.json');

function loadModels() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([]));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveModels(models) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(models, null, 2));
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    const id = uuidv4();
    const ext = path.extname(file.originalname);
    cb(null, `${id}${ext}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ['.glb', '.gltf', '.obj', '.fbx', '.stl'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} not supported. Use: ${allowed.join(', ')}`));
    }
  },
  limits: { fileSize: 100 * 1024 * 1024 }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.json());

app.post('/api/upload', upload.single('model'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const models = loadModels();
  const id = path.basename(req.file.filename, path.extname(req.file.filename));
  const modelUrl = `/uploads/${req.file.filename}`;
  const viewerUrl = `/viewer.html?id=${id}`;

  const qrDataUrl = await QRCode.toDataURL(viewerUrl, {
    width: 512,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' }
  });

  const entry = {
    id,
    name: req.body.name || req.file.originalname,
    filename: req.file.filename,
    originalName: req.file.originalname,
    modelUrl,
    viewerUrl,
    qrCode: qrDataUrl,
    createdAt: new Date().toISOString()
  };

  models.push(entry);
  saveModels(models);

  res.json(entry);
});

app.get('/api/models', (req, res) => {
  const models = loadModels();
  res.json(models);
});

app.get('/api/models/:id', (req, res) => {
  const models = loadModels();
  const model = models.find(m => m.id === req.params.id);
  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }
  res.json(model);
});

app.delete('/api/models/:id', (req, res) => {
  let models = loadModels();
  const model = models.find(m => m.id === req.params.id);
  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }

  const filePath = path.join(__dirname, 'uploads', model.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  models = models.filter(m => m.id !== req.params.id);
  saveModels(models);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`ARViewer running at http://localhost:${PORT}`);
});

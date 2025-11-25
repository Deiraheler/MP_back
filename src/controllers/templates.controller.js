import { Template } from "../models/Template.js";

export async function getMyTemplates(req, res) {
  const templates = await Template.find({ user: req.user._id }).sort({ createdAt: -1 }).lean();
  return res.json({ templates });
}

export async function createTemplate(req, res) {
  const { name, type, content } = req.body || {};
  if (!name || !type) {
    return res.status(400).json({ message: "Name and type are required" });
  }
  const template = await Template.create({ user: req.user._id, name, type, content: content || "" });
  return res.status(201).json({ template });
}

export async function updateTemplate(req, res) {
  const { id } = req.params;
  const { name, type, content } = req.body || {};
  const template = await Template.findOne({ _id: id, user: req.user._id });
  if (!template) return res.status(404).json({ message: "Template not found" });
  if (name !== undefined) template.name = name;
  if (type !== undefined) template.type = type;
  if (content !== undefined) template.content = content;
  await template.save();
  return res.json({ template });
}

export async function deleteTemplate(req, res) {
  const { id } = req.params;
  const template = await Template.findOneAndDelete({ _id: id, user: req.user._id });
  if (!template) return res.status(404).json({ message: "Template not found" });
  return res.json({ message: "Template deleted" });
}


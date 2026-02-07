const News = require("../models/news");

exports.getAllNews = async (req, res) => {
  try {
    const news = await News.find().sort({ createdAt: -1 });
    res.json(news);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.createNews = async (req, res) => {
  try {
    const { title, content, image } = req.body;
    const news = new News({ title, content, image });
    await news.save();
    res.status(201).json(news);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

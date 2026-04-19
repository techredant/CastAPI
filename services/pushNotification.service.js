const { Expo } = require("expo-server-sdk");
const expo = new Expo();

async function sendPushNotification(token, title, body) {
  if (!token || !Expo.isExpoPushToken(token)) return;

  const messages = [
    {
      to: token,
      sound: "default",
      title,
      body,
    },
  ];

  await expo.sendPushNotificationsAsync(messages);
}

module.exports = { sendPushNotification };

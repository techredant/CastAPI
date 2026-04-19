let Expo;

async function getExpo() {
  if (!Expo) {
    const module = await import("expo-server-sdk");
    Expo = module.Expo;
  }
  return Expo;
}

async function sendPushNotification(token, title, body) {
  if (!token) return;

  const ExpoClass = await getExpo();
  const expo = new ExpoClass();

  if (!ExpoClass.isExpoPushToken(token)) return;

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

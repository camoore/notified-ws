import Notification from "./model.js"

export const getNotifications = async () => {
  try {
    return await Notification.find();
  } catch (error) {
    console.log("There was an error getting notifications", error);
    return [];
  }
};

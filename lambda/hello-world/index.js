exports.handler = async (event) => {
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'PantryMind Lambda pipeline is live', receivedEvent: event ?? null }),
  };
};

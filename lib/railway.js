export async function updateRailwayReplicas(numReplicas) {
  const query = `
    mutation updateServiceInstance($environmentId: String!, $serviceId: String!, $numReplicas: Int) {
      serviceInstanceUpdate(
        environmentId: $environmentId
        serviceId: $serviceId
        input: { numReplicas: $numReplicas }
      )
    }
  `;

  const variables = {
    environmentId: process.env.RAILWAY_ENVIRONMENT_ID,
    serviceId: process.env.RAILWAY_SERVICE_ID,
    numReplicas: numReplicas
  };

  const res = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.RAILWAY_API_TOKEN}`
    },
    body: JSON.stringify({ query, variables })
  });

  const json = await res.json();
  if (json.errors) {
    throw new Error(json.errors[0].message);
  }
  return json;
}

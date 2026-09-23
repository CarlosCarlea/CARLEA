const asset = (name) => new URL(`../assets/${name}`, import.meta.url).href;

export const catalog = [
  {
    id: "cdb14983-9163-41a3-a58f-b6a372c05647",
    slug: "majo",
    stage_name: "Majo",
    bio: "Conversación, planes boutique y experiencias seleccionadas.",
    city: "Bogotá",
    cover: asset("Majo_cover.jpg"),
  },
  {
    id: "685c9a00-3d2c-4fe8-a468-a81b70be402e",
    slug: "emma",
    stage_name: "Emma",
    bio: "Experiencias sociales relajadas, música y conversación.",
    city: "Bogotá",
    cover: asset("Emma_cover.jpg"),
  },
  {
    id: "8af05409-aea8-426d-99eb-6fafccfb89d5",
    slug: "alisson",
    stage_name: "Alisson",
    bio: "Planes creativos, cultura urbana y conversación.",
    city: "Bogotá",
    cover: asset("Alisson_cover.jpg"),
  },
  {
    id: "d73d2725-298a-4bf0-bddb-7f01b53fe90d",
    slug: "lorena",
    stage_name: "Lorena",
    bio: "Experiencias culturales, lectura y conversación.",
    city: "Bogotá",
    cover: asset("Lorena_cover.jpg"),
  },
];

export const fallbackCover = asset("logo.png");

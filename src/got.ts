import Nightmare from 'nightmare';
import parseHumanDate from 'parse-human-date';
import { ago as timeAgo } from 'time-ago';
import humanFormat from 'human-format';

const eachSeries = async<ValueType>(iterable: Iterable<ValueType | PromiseLike<ValueType>>, iterator: (element: ValueType, index: number) => unknown): Promise<ValueType[]> => {
	let index = 0;

	for (const value of iterable) {
		// eslint-disable-next-line no-await-in-loop
		await iterator(await value, index++);
	}

	return iterable as unknown as Promise<ValueType[]>;
};

const getStats = async function(name: string) {
  const nightmare = new Nightmare();

  // Goto the page
  await nightmare.goto(`https://onlyfans.com/${name}`);

  // Wait till the page is loaded
  await nightmare.wait('.b-profile__sections__count');

  // Get profile items
  const { profileItems, ...result } = await nightmare.evaluate(() => {
    const lastOnline = (document.querySelector('.b-profile__user__status__text')?.children[0] as HTMLElement)?.title.toLowerCase();
    const profileItems = [...document.querySelectorAll('.b-profile__sections__count')].map(element => element.innerHTML, 10);
    return {
      profileItems,
      lastOnline
    }
  }) as unknown as {
    profileItems: string[];
    lastOnline: string;
  };

  // Close session
  await nightmare.end();

  // Get the last time the account was online
  const lastOnline = result.lastOnline ? timeAgo(parseHumanDate(result.lastOnline)) : '';

  // Images | Videos | Likes
  if (profileItems.length === 3) {
    const images = humanFormat.parse(profileItems[0].toLowerCase());
    const videos = humanFormat.parse(profileItems[1].toLowerCase());
    const likes = humanFormat.parse(profileItems[2].toLowerCase());
    const averageLikesPerPost = Number((likes / (images + videos)).toFixed(2));
    return {
      name,
      posts: images + videos,
      images,
      videos,
      likes,
      lastOnline,
      averageLikesPerPost
    };
  }

  // Posts | Likes
  if (profileItems.length === 2) {
    const posts = humanFormat.parse(profileItems[0].toLowerCase());
    const likes = humanFormat.parse(profileItems[1].toLowerCase());
    const averageLikesPerPost = Number((likes / posts).toFixed(2));
    return {
      name,
      posts,
      images: undefined,
      videos: undefined,
      likes,
      lastOnline,
      averageLikesPerPost
    };
  }

  throw new Error('Invalid profile');
};

const getAndLog = async (name: string) => {
  const result = await getStats(name);
  let text = `${result.name} has`;

  // Add images count
  if (result.images) {
      text += ` ${result.images} images,`;
  }

  // Add video count
  if (result.videos) {
      text += ` ${result.videos} videos and`;
  }

  // Add total posts
  text += ` ${result.posts} total posts.`;

  text += ` On average they get ${result.averageLikesPerPost} likes per post.`;

  // Add time they were last online
  if (result.lastOnline) {
      text += ` They were last online ${result.lastOnline}.`
  }

  console.log(text);

  return result;
}

(async () => {
  const stats = await eachSeries([
    'ittybittyprettykitty',
    'rope-and-roses',
    'cptnjuju-',
    'modernmuse',
    'luciababesxo',
    'halihalsey',
    'elenaaphrodite',
    'nsoutherlynn',
    'scarlettsorcery',
    'luabunny',
    'puchoszopu',
    'babyxharu',
    'realartichoke',
    'bubblegumivy',
    'facesittingqueen15',
    'wildbunnyx',
    'itsmeshan',
    'xxxlazulixxx',
    'leeonyy',
    'chakra_kitty',
    'marzziexoxo',
    'MiladyAmara',
    'jaqquicksilver',
    'beeangel',
    'three_little_vixens',
    'kairijadevip',
    'amayagem',
    'venusmayson',
    'xoxohazeljade',
    'prettyykittyy_420',
    'xxxlazulixxx',
    'angelbaabes',
    'ivy-yue',
  ], getAndLog);

  console.log(stats);
})();

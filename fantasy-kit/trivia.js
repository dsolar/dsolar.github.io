/* Fantasy Kit: trivia for a trivia draft. On the clock, you answer an easy multiple-choice question before you pick:
   four choices, 15 seconds. Miss it and your pick moves to the end of the round.

   Questions come from two places: a hand-checked bank of well-known facts for each sport (records, award winners,
   #1 picks, colleges, nicknames), and questions built from the player pool itself ("Which team does he play for?",
   "Which of these receivers didn't go to LSU?"), so they change as rosters do.

   FK.trivia:
     BANK                         the football questions: { id, q, a (the answer), w (three wrong answers) }
     BANKS                        every sport's: { nfl, nba, mlb }
     make(sport, players, seed, used)  a question for a pick: { id, q, opts: [4 strings], c (the right one's index) }
*/
(function (root, factory) {
  const m = factory(root.FK ? root.FK.sports : typeof require !== "undefined" ? require("./sports.js") : null);
  if (typeof module !== "undefined" && module.exports) module.exports = m;
  else (root.FK = root.FK || {}).trivia = m;
})(this, function (S) {
  "use strict";
  const BANK = [
    // records
    { id: "rec-td", q: "Who holds the record for receiving touchdowns in a season, with 23?", a: "Randy Moss", w: ["Jerry Rice", "Calvin Johnson", "Davante Adams"] },
    { id: "pass-td", q: "Who holds the record for passing touchdowns in a season, with 55?", a: "Peyton Manning", w: ["Tom Brady", "Patrick Mahomes", "Drew Brees"] },
    { id: "rush-yd", q: "Who holds the record for rushing yards in a season?", a: "Eric Dickerson", w: ["Adrian Peterson", "Barry Sanders", "Derrick Henry"] },
    { id: "rec-yd", q: "Who holds the record for receiving yards in a season?", a: "Calvin Johnson", w: ["Julio Jones", "Jerry Rice", "Randy Moss"] },
    { id: "rush-td", q: "Who holds the record for rushing touchdowns in a season, with 28?", a: "LaDainian Tomlinson", w: ["Emmitt Smith", "Shaun Alexander", "Priest Holmes"] },
    { id: "catches", q: "Who holds the record for catches in a season, with 149?", a: "Michael Thomas", w: ["Marvin Harrison", "Cooper Kupp", "Wes Welker"] },
    { id: "pass-yd", q: "Who holds the record for passing yards in a season?", a: "Peyton Manning", w: ["Drew Brees", "Dan Marino", "Patrick Mahomes"] },
    { id: "car-rush", q: "Who has the most career rushing yards in NFL history?", a: "Emmitt Smith", w: ["Walter Payton", "Barry Sanders", "Frank Gore"] },
    { id: "car-rec", q: "Who has the most career receiving yards in NFL history?", a: "Jerry Rice", w: ["Larry Fitzgerald", "Terrell Owens", "Randy Moss"] },
    { id: "car-ptd", q: "Who has thrown the most touchdown passes in NFL history?", a: "Tom Brady", w: ["Drew Brees", "Peyton Manning", "Brett Favre"] },
    { id: "car-pyd", q: "Who has the most career passing yards in NFL history?", a: "Tom Brady", w: ["Drew Brees", "Peyton Manning", "Brett Favre"] },
    { id: "car-sack", q: "Who has the most career sacks since the NFL started counting them in 1982?", a: "Bruce Smith", w: ["Reggie White", "Michael Strahan", "J.J. Watt"] },
    { id: "sb-most", q: "Which player has won the most Super Bowls?", a: "Tom Brady", w: ["Joe Montana", "Charles Haley", "Terry Bradshaw"] },
    // Heisman winners
    { id: "h-uf", q: "Which Florida quarterback is the school's most recent Heisman winner?", a: "Tim Tebow", w: ["Chris Leak", "Kyle Trask", "Anthony Richardson"] },
    { id: "h-two", q: "Who is the only player to win the Heisman Trophy twice?", a: "Archie Griffin", w: ["Tim Tebow", "Herschel Walker", "Barry Sanders"] },
    { id: "h-lamar", q: "Lamar Jackson won the Heisman at which school?", a: "Louisville", w: ["Florida State", "Clemson", "Miami"] },
    { id: "h-2024", q: "Which two-way star won the 2024 Heisman Trophy?", a: "Travis Hunter", w: ["Ashton Jeanty", "Cam Ward", "Shedeur Sanders"] },
    { id: "h-2023", q: "Who won the 2023 Heisman Trophy?", a: "Jayden Daniels", w: ["Bo Nix", "Michael Penix Jr.", "Marvin Harrison Jr."] },
    { id: "h-2022", q: "Who won the 2022 Heisman Trophy at USC?", a: "Caleb Williams", w: ["Matt Leinart", "Sam Darnold", "Carson Palmer"] },
    { id: "h-2020", q: "Which wide receiver won the 2020 Heisman Trophy?", a: "DeVonta Smith", w: ["Ja'Marr Chase", "Jaylen Waddle", "Justin Jefferson"] },
    { id: "h-woodson", q: "Which Michigan cornerback won the 1997 Heisman Trophy?", a: "Charles Woodson", w: ["Deion Sanders", "Champ Bailey", "Ed Reed"] },
    { id: "h-henry", q: "Derrick Henry won the Heisman at which school?", a: "Alabama", w: ["Georgia", "Auburn", "Tennessee"] },
    // #1 picks
    { id: "p1-2025", q: "Who was the first pick in the 2025 NFL Draft?", a: "Cam Ward", w: ["Travis Hunter", "Abdul Carter", "Shedeur Sanders"] },
    { id: "p1-2024", q: "Who was the first pick in the 2024 NFL Draft?", a: "Caleb Williams", w: ["Jayden Daniels", "Drake Maye", "Marvin Harrison Jr."] },
    { id: "p1-2023", q: "Who was the first pick in the 2023 NFL Draft?", a: "Bryce Young", w: ["C.J. Stroud", "Anthony Richardson", "Will Levis"] },
    { id: "p1-2021", q: "Who was the first pick in the 2021 NFL Draft?", a: "Trevor Lawrence", w: ["Zach Wilson", "Trey Lance", "Justin Fields"] },
    { id: "p1-2020", q: "Who was the first pick in the 2020 NFL Draft?", a: "Joe Burrow", w: ["Chase Young", "Tua Tagovailoa", "Justin Herbert"] },
    { id: "p1-2018", q: "Who was the first pick in the 2018 NFL Draft?", a: "Baker Mayfield", w: ["Saquon Barkley", "Sam Darnold", "Josh Allen"] },
    { id: "p1-2016", q: "Who was the first pick in the 2016 NFL Draft?", a: "Jared Goff", w: ["Carson Wentz", "Joey Bosa", "Ezekiel Elliott"] },
    { id: "p1-2012", q: "Who was the first pick in the 2012 NFL Draft?", a: "Andrew Luck", w: ["Robert Griffin III", "Ryan Tannehill", "Russell Wilson"] },
    { id: "p1-2009", q: "Who was the first pick in the 2009 NFL Draft?", a: "Matthew Stafford", w: ["Mark Sanchez", "Josh Freeman", "Aaron Curry"] },
    { id: "brady-rd", q: "In which round was Tom Brady drafted?", a: "Sixth", w: ["First", "Third", "Fourth"] },
    { id: "purdy", q: "Brock Purdy was the last pick in his draft. What is that spot called?", a: "Mr. Irrelevant", w: ["Mr. Overlooked", "The Closer", "Last Call"] },
    // colleges
    { id: "c-mahomes", q: "Where did Patrick Mahomes play college football?", a: "Texas Tech", w: ["Texas", "Baylor", "Oklahoma State"] },
    { id: "c-allen", q: "Where did Josh Allen play college football?", a: "Wyoming", w: ["Boise State", "Fresno State", "Colorado State"] },
    { id: "c-rodgers", q: "Where did Aaron Rodgers play major college football?", a: "California", w: ["Oregon", "Stanford", "Fresno State"] },
    { id: "c-jj", q: "Where did Justin Jefferson play college football?", a: "LSU", w: ["Alabama", "Ohio State", "Clemson"] },
    { id: "c-cmc", q: "Where did Christian McCaffrey play college football?", a: "Stanford", w: ["USC", "Oregon", "Notre Dame"] },
    { id: "c-kelce", q: "Where did Travis Kelce play college football?", a: "Cincinnati", w: ["Pittsburgh", "Ohio State", "Kent State"] },
    { id: "c-lamb", q: "Where did CeeDee Lamb play college football?", a: "Oklahoma", w: ["Texas", "LSU", "Alabama"] },
    { id: "c-hurts", q: "Before Oklahoma, Jalen Hurts started at which school?", a: "Alabama", w: ["Texas", "Georgia", "LSU"] },
    { id: "c-burrow", q: "Joe Burrow transferred to LSU from which school?", a: "Ohio State", w: ["Michigan", "Penn State", "Iowa"] },
    { id: "c-saquon", q: "Where did Saquon Barkley play college football?", a: "Penn State", w: ["Ohio State", "Michigan", "Rutgers"] },
    { id: "c-bijan", q: "Where did Bijan Robinson play college football?", a: "Texas", w: ["Oklahoma", "Arizona", "USC"] },
    { id: "c-arsb", q: "Where did Amon-Ra St. Brown play college football?", a: "USC", w: ["Stanford", "UCLA", "Notre Dame"] },
    { id: "c-purdy", q: "Where did Brock Purdy play college football?", a: "Iowa State", w: ["Iowa", "Kansas State", "Nebraska"] },
    { id: "c-chase", q: "Ja'Marr Chase and Joe Burrow won a national title together at which school?", a: "LSU", w: ["Clemson", "Alabama", "Ohio State"] },
    { id: "kyler", q: "Kyler Murray was also a first-round pick in which other sport?", a: "Baseball", w: ["Basketball", "Hockey", "Soccer"] },
    // nicknames
    { id: "n-mega", q: "Which receiver was nicknamed \"Megatron\"?", a: "Calvin Johnson", w: ["Randy Moss", "Andre Johnson", "Terrell Owens"] },
    { id: "n-beast", q: "Which running back was nicknamed \"Beast Mode\"?", a: "Marshawn Lynch", w: ["Adrian Peterson", "Derrick Henry", "LeSean McCoy"] },
    { id: "n-sweet", q: "Which running back was nicknamed \"Sweetness\"?", a: "Walter Payton", w: ["Barry Sanders", "Emmitt Smith", "Eric Dickerson"] },
    { id: "n-prime", q: "Who was nicknamed \"Prime Time\"?", a: "Deion Sanders", w: ["Michael Irvin", "Jerry Rice", "Ray Lewis"] },
    { id: "n-cheetah", q: "Which receiver is nicknamed \"Cheetah\"?", a: "Tyreek Hill", w: ["DK Metcalf", "Stefon Diggs", "Davante Adams"] },
    // teams and the game
    { id: "lambeau", q: "Which team plays its home games at Lambeau Field?", a: "Green Bay Packers", w: ["Chicago Bears", "Minnesota Vikings", "Detroit Lions"] },
    { id: "arrowhead", q: "Which team plays its home games at Arrowhead Stadium?", a: "Kansas City Chiefs", w: ["Denver Broncos", "Las Vegas Raiders", "Los Angeles Chargers"] },
    { id: "americas", q: "Which team is known as \"America's Team\"?", a: "Dallas Cowboys", w: ["New York Giants", "Green Bay Packers", "Pittsburgh Steelers"] },
    { id: "safety", q: "How many points is a safety worth?", a: "2", w: ["3", "4", "6"] },
    { id: "fg", q: "How many points is a field goal worth?", a: "3", w: ["1", "2", "4"] },
    { id: "eleven", q: "How many players does each team have on the field at once?", a: "11", w: ["9", "10", "12"] },
    { id: "lombardi", q: "The Lombardi Trophy goes to the winner of what?", a: "The Super Bowl", w: ["The NFC title game", "The Pro Bowl", "The college national title"] },
    { id: "peyton", q: "Peyton Manning finished his career with which team?", a: "Denver Broncos", w: ["Indianapolis Colts", "Tennessee Titans", "New York Jets"] },
    { id: "brady-tb", q: "Tom Brady won Super Bowls with the Patriots and which other team?", a: "Tampa Bay Buccaneers", w: ["Miami Dolphins", "San Francisco 49ers", "Las Vegas Raiders"] },
    { id: "rodgers-gb", q: "Which team drafted Aaron Rodgers?", a: "Green Bay Packers", w: ["San Francisco 49ers", "New York Jets", "Pittsburgh Steelers"] },
  ];
  const NBA = [
    // records
    { id: "nba-pts", q: "Who has scored the most points in NBA history?", a: "LeBron James", w: ["Kareem Abdul-Jabbar", "Karl Malone", "Kobe Bryant"] },
    { id: "nba-100", q: "Who scored 100 points in a single NBA game?", a: "Wilt Chamberlain", w: ["Kobe Bryant", "Michael Jordan", "Elgin Baylor"] },
    { id: "nba-rings", q: "Which player won the most NBA championships, with 11?", a: "Bill Russell", w: ["Michael Jordan", "Robert Horry", "Kareem Abdul-Jabbar"] },
    { id: "nba-3s", q: "Who has made the most three-pointers in NBA history?", a: "Stephen Curry", w: ["Ray Allen", "James Harden", "Reggie Miller"] },
    { id: "nba-ast", q: "Who has the most assists in NBA history?", a: "John Stockton", w: ["Magic Johnson", "Jason Kidd", "Steve Nash"] },
    { id: "nba-reb", q: "Who has the most rebounds in NBA history?", a: "Wilt Chamberlain", w: ["Bill Russell", "Dennis Rodman", "Moses Malone"] },
    { id: "nba-73", q: "Which team set the regular-season record by going 73-9?", a: "2015-16 Golden State Warriors", w: ["1995-96 Chicago Bulls", "2012-13 Miami Heat", "1985-86 Boston Celtics"] },
    // #1 picks
    { id: "nba-p1-2003", q: "Who was the first pick in the 2003 NBA Draft?", a: "LeBron James", w: ["Darko Milicic", "Carmelo Anthony", "Dwyane Wade"] },
    { id: "nba-p1-2019", q: "Who was the first pick in the 2019 NBA Draft?", a: "Zion Williamson", w: ["Ja Morant", "RJ Barrett", "Darius Garland"] },
    { id: "nba-p1-2018", q: "Who was the first pick in the 2018 NBA Draft?", a: "Deandre Ayton", w: ["Luka Doncic", "Trae Young", "Jaren Jackson Jr."] },
    { id: "nba-p1-2023", q: "Who was the first pick in the 2023 NBA Draft?", a: "Victor Wembanyama", w: ["Brandon Miller", "Scoot Henderson", "Amen Thompson"] },
    { id: "nba-p1-2025", q: "Who was the first pick in the 2025 NBA Draft?", a: "Cooper Flagg", w: ["Dylan Harper", "VJ Edgecombe", "Ace Bailey"] },
    { id: "nba-p1-2012", q: "Who was the first pick in the 2012 NBA Draft?", a: "Anthony Davis", w: ["Bradley Beal", "Damian Lillard", "Andre Drummond"] },
    { id: "nba-kobe", q: "Which team drafted Kobe Bryant before trading him to the Lakers?", a: "Charlotte Hornets", w: ["Philadelphia 76ers", "Boston Celtics", "New Jersey Nets"] },
    { id: "nba-lebron-hs", q: "LeBron James went to the NBA straight from where?", a: "High school", w: ["Ohio State", "Michigan State", "Kentucky"] },
    // colleges and countries
    { id: "nba-mj", q: "Where did Michael Jordan play college basketball?", a: "North Carolina", w: ["Duke", "Kentucky", "Georgetown"] },
    { id: "nba-curry", q: "Where did Stephen Curry play college basketball?", a: "Davidson", w: ["Duke", "Virginia Tech", "Wake Forest"] },
    { id: "nba-kd", q: "Where did Kevin Durant play college basketball?", a: "Texas", w: ["Kansas", "Georgetown", "Maryland"] },
    { id: "nba-duncan", q: "Where did Tim Duncan play college basketball?", a: "Wake Forest", w: ["Duke", "Georgetown", "Kentucky"] },
    { id: "nba-tatum", q: "Where did Jayson Tatum play college basketball?", a: "Duke", w: ["Kentucky", "Kansas", "North Carolina"] },
    { id: "nba-shaq", q: "Where did Shaquille O'Neal play college basketball?", a: "LSU", w: ["Kentucky", "Georgetown", "UCLA"] },
    { id: "nba-jokic", q: "Which country is Nikola Jokic from?", a: "Serbia", w: ["Croatia", "Slovenia", "Greece"] },
    { id: "nba-luka", q: "Which country is Luka Doncic from?", a: "Slovenia", w: ["Serbia", "Croatia", "Spain"] },
    { id: "nba-giannis", q: "Which country is Giannis Antetokounmpo from?", a: "Greece", w: ["Turkey", "Spain", "France"] },
    { id: "nba-wemby", q: "Which country is Victor Wembanyama from?", a: "France", w: ["Belgium", "Spain", "Germany"] },
    // nicknames
    { id: "nba-mailman", q: "Which player was nicknamed \"The Mailman\"?", a: "Karl Malone", w: ["John Stockton", "Charles Barkley", "Patrick Ewing"] },
    { id: "nba-answer", q: "Which player was nicknamed \"The Answer\"?", a: "Allen Iverson", w: ["Vince Carter", "Tracy McGrady", "Kobe Bryant"] },
    { id: "nba-freak", q: "Who is nicknamed \"The Greek Freak\"?", a: "Giannis Antetokounmpo", w: ["Nikola Jokic", "Luka Doncic", "Rudy Gobert"] },
    { id: "nba-king", q: "Who is nicknamed \"King James\"?", a: "LeBron James", w: ["James Harden", "Kevin Durant", "Kyrie Irving"] },
    { id: "nba-mamba", q: "Who was nicknamed \"The Black Mamba\"?", a: "Kobe Bryant", w: ["Michael Jordan", "Dwyane Wade", "Allen Iverson"] },
    // teams and the game
    { id: "nba-msg", q: "Which team plays its home games at Madison Square Garden?", a: "New York Knicks", w: ["Brooklyn Nets", "Philadelphia 76ers", "Boston Celtics"] },
    { id: "nba-td", q: "Which team plays its home games at TD Garden?", a: "Boston Celtics", w: ["Toronto Raptors", "New York Knicks", "Brooklyn Nets"] },
    { id: "nba-five", q: "How many players does each team have on the court at once?", a: "5", w: ["4", "6", "7"] },
    { id: "nba-qtr", q: "How long is a quarter in an NBA game?", a: "12 minutes", w: ["10 minutes", "15 minutes", "20 minutes"] },
    { id: "nba-3pt", q: "How many points is a shot from behind the arc worth?", a: "3", w: ["2", "4", "1"] },
  ];
  const MLB = [
    // records
    { id: "mlb-hr", q: "Who has hit the most home runs in MLB history?", a: "Barry Bonds", w: ["Hank Aaron", "Babe Ruth", "Albert Pujols"] },
    { id: "mlb-hr73", q: "Who holds the record for home runs in a season, with 73?", a: "Barry Bonds", w: ["Mark McGwire", "Sammy Sosa", "Aaron Judge"] },
    { id: "mlb-al62", q: "Who set the American League record with 62 home runs in a season?", a: "Aaron Judge", w: ["Roger Maris", "Babe Ruth", "Mickey Mantle"] },
    { id: "mlb-hits", q: "Who has the most hits in MLB history?", a: "Pete Rose", w: ["Ty Cobb", "Hank Aaron", "Derek Jeter"] },
    { id: "mlb-streak", q: "Who played in a record 2,632 games in a row?", a: "Cal Ripken Jr.", w: ["Lou Gehrig", "Derek Jeter", "Pete Rose"] },
    { id: "mlb-k", q: "Which pitcher has the most strikeouts in MLB history?", a: "Nolan Ryan", w: ["Randy Johnson", "Roger Clemens", "Steve Carlton"] },
    { id: "mlb-wins", q: "Which pitcher has the most wins in MLB history, with 511?", a: "Cy Young", w: ["Walter Johnson", "Christy Mathewson", "Greg Maddux"] },
    { id: "mlb-406", q: "Who was the last American or National League player to hit .400 in a season?", a: "Ted Williams", w: ["Tony Gwynn", "George Brett", "Ty Cobb"] },
    { id: "mlb-56", q: "Who had a 56-game hitting streak?", a: "Joe DiMaggio", w: ["Pete Rose", "Ty Cobb", "Ichiro Suzuki"] },
    { id: "mlb-mo", q: "Who was the first player elected to the Hall of Fame unanimously by the baseball writers?", a: "Mariano Rivera", w: ["Derek Jeter", "Ken Griffey Jr.", "Tom Seaver"] },
    // history
    { id: "mlb-jackie", q: "Jackie Robinson broke baseball's color barrier with which team?", a: "Brooklyn Dodgers", w: ["New York Giants", "Boston Braves", "St. Louis Cardinals"] },
    { id: "mlb-42", q: "On Jackie Robinson Day, every player wears which number?", a: "42", w: ["24", "21", "44"] },
    { id: "mlb-cubs", q: "Which team won the 2016 World Series, its first title in 108 years?", a: "Chicago Cubs", w: ["Cleveland Indians", "Boston Red Sox", "San Francisco Giants"] },
    { id: "mlb-curse", q: "Which team ended the \"Curse of the Bambino\" by winning the 2004 World Series?", a: "Boston Red Sox", w: ["Chicago Cubs", "Chicago White Sox", "Cleveland Indians"] },
    { id: "mlb-27", q: "Which team has won the most World Series titles?", a: "New York Yankees", w: ["St. Louis Cardinals", "Boston Red Sox", "Los Angeles Dodgers"] },
    { id: "mlb-ohtani", q: "Shohei Ohtani started his MLB career with which team?", a: "Los Angeles Angels", w: ["Seattle Mariners", "Los Angeles Dodgers", "San Diego Padres"] },
    // nicknames
    { id: "mlb-bambino", q: "Which player was nicknamed \"The Bambino\"?", a: "Babe Ruth", w: ["Lou Gehrig", "Joe DiMaggio", "Mickey Mantle"] },
    { id: "mlb-october", q: "Which player was nicknamed \"Mr. October\"?", a: "Reggie Jackson", w: ["Derek Jeter", "David Ortiz", "Mickey Mantle"] },
    { id: "mlb-papi", q: "Which player was nicknamed \"Big Papi\"?", a: "David Ortiz", w: ["Manny Ramirez", "Albert Pujols", "Miguel Cabrera"] },
    { id: "mlb-unit", q: "Which pitcher was nicknamed \"The Big Unit\"?", a: "Randy Johnson", w: ["Roger Clemens", "CC Sabathia", "Curt Schilling"] },
    // ballparks and the game
    { id: "mlb-monster", q: "Which ballpark has the Green Monster in left field?", a: "Fenway Park", w: ["Wrigley Field", "Yankee Stadium", "Dodger Stadium"] },
    { id: "mlb-ivy", q: "Which ballpark is known for ivy on its outfield walls?", a: "Wrigley Field", w: ["Fenway Park", "Camden Yards", "Oracle Park"] },
    { id: "mlb-outs", q: "How many outs does each team get in an inning?", a: "3", w: ["2", "4", "5"] },
    { id: "mlb-inn", q: "How many innings are in a regulation MLB game?", a: "9", w: ["7", "8", "10"] },
    { id: "mlb-balls", q: "How many balls is a walk?", a: "4", w: ["3", "5", "6"] },
  ];
  const BANKS = { nfl: BANK, nba: NBA, mlb: MLB };

  // a small seeded random number generator, the same on every page
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  const shuffle = (a, r) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const POS = { QB: ["quarterback", "quarterbacks"], RB: ["running back", "running backs"], WR: ["receiver", "receivers"], TE: ["tight end", "tight ends"] };
  const NFL_TEAMS = { ARI: "Arizona Cardinals", ATL: "Atlanta Falcons", BAL: "Baltimore Ravens", BUF: "Buffalo Bills", CAR: "Carolina Panthers", CHI: "Chicago Bears", CIN: "Cincinnati Bengals", CLE: "Cleveland Browns",
    DAL: "Dallas Cowboys", DEN: "Denver Broncos", DET: "Detroit Lions", GB: "Green Bay Packers", HOU: "Houston Texans", IND: "Indianapolis Colts", JAX: "Jacksonville Jaguars", KC: "Kansas City Chiefs",
    LV: "Las Vegas Raiders", LAC: "Los Angeles Chargers", LAR: "Los Angeles Rams", MIA: "Miami Dolphins", MIN: "Minnesota Vikings", NE: "New England Patriots", NO: "New Orleans Saints", NYG: "New York Giants",
    NYJ: "New York Jets", PHI: "Philadelphia Eagles", PIT: "Pittsburgh Steelers", SF: "San Francisco 49ers", SEA: "Seattle Seahawks", TB: "Tampa Bay Buccaneers", TEN: "Tennessee Titans", WAS: "Washington Commanders" };
  const TEAMS = {
    nfl: NFL_TEAMS,
    nba: { ATL: "Atlanta Hawks", BOS: "Boston Celtics", BRK: "Brooklyn Nets", CHI: "Chicago Bulls", CHO: "Charlotte Hornets", CLE: "Cleveland Cavaliers", DAL: "Dallas Mavericks", DEN: "Denver Nuggets",
      DET: "Detroit Pistons", GSW: "Golden State Warriors", HOU: "Houston Rockets", IND: "Indiana Pacers", LAC: "LA Clippers", LAL: "Los Angeles Lakers", MEM: "Memphis Grizzlies", MIA: "Miami Heat",
      MIL: "Milwaukee Bucks", MIN: "Minnesota Timberwolves", NOP: "New Orleans Pelicans", NYK: "New York Knicks", OKC: "Oklahoma City Thunder", ORL: "Orlando Magic", PHI: "Philadelphia 76ers", PHO: "Phoenix Suns",
      POR: "Portland Trail Blazers", SAC: "Sacramento Kings", SAS: "San Antonio Spurs", TOR: "Toronto Raptors", UTA: "Utah Jazz", WAS: "Washington Wizards" },
    mlb: { ARI: "Arizona Diamondbacks", ATH: "Athletics", ATL: "Atlanta Braves", BAL: "Baltimore Orioles", BOS: "Boston Red Sox", CHC: "Chicago Cubs", CIN: "Cincinnati Reds", CLE: "Cleveland Guardians",
      COL: "Colorado Rockies", CWS: "Chicago White Sox", DET: "Detroit Tigers", HOU: "Houston Astros", KC: "Kansas City Royals", LAA: "Los Angeles Angels", LAD: "Los Angeles Dodgers", MIA: "Miami Marlins",
      MIL: "Milwaukee Brewers", MIN: "Minnesota Twins", NYM: "New York Mets", NYY: "New York Yankees", PHI: "Philadelphia Phillies", PIT: "Pittsburgh Pirates", SD: "San Diego Padres", SEA: "Seattle Mariners",
      SF: "San Francisco Giants", STL: "St. Louis Cardinals", TB: "Tampa Bay Rays", TEX: "Texas Rangers", TOR: "Toronto Blue Jays", WSH: "Washington Nationals" },
  };
  const main = (p) => S.positions(p)[0];
  // the players people know: the top of the pool by value, on a team
  const known = (players, n, sport) => players.filter((p) => p.t && (TEAMS[(sport && sport.key) || "nfl"] || {})[p.t] && (!sport || sport.key !== "nfl" || POS[main(p)])).sort((a, b) => (b.v || 0) - (a.v || 0)).slice(0, n);
  const schoolOf = (p) => (p.col ? String(p.col).replace(/\s+St\.$/, " State") : null);
  // The player data has each player's last college. These players also played somewhere else first, so a question
  // about one of those schools leaves them out ("didn't play at Alabama" can't be Jalen Hurts).
  const EARLIER = {
    "Jalen Hurts": "Alabama", "Joe Burrow": "Ohio State", "Baker Mayfield": "Texas Tech", "Bo Nix": "Auburn", "Michael Penix Jr.": "Indiana", "Jayden Daniels": "Arizona State",
    "Caleb Williams": "Oklahoma", "Cam Ward": "Washington State|Incarnate Word", "Kyler Murray": "Texas A&M", "Jameson Williams": "Ohio State", "Puka Nacua": "Washington", "Jordan Addison": "Pittsburgh",
    "Jahmyr Gibbs": "Georgia Tech", "Quinshon Judkins": "Ole Miss", "Kenneth Walker III": "Wake Forest", "Alvin Kamara": "Alabama", "Zach Charbonnet": "Michigan", "Bucky Irving": "Minnesota",
    "Tank Dell": "Alabama A&M", "Jaxson Dart": "USC", "Tyler Shough": "Oregon|Texas Tech", "Malik Willis": "Auburn", "Jayden Reed": "Western Michigan", "Keon Coleman": "Michigan State",
    "Juwan Johnson": "Penn State", "Ray Davis": "Temple|Vanderbilt", "Chase Brown": "Western Michigan", "Woody Marks": "Mississippi State", "Tyrone Tracy Jr.": "Iowa", "Quinn Ewers": "Ohio State",
    "Shedeur Sanders": "Jackson State", "Travis Hunter": "Jackson State", "Cam Skattebo": "Sacramento State", "Dalton Kincaid": "San Diego", "Jaylen Warren": "Utah State", "Trey Benson": "Oregon",
    "MarShawn Lloyd": "South Carolina", "Isaac Guerendo": "Wisconsin", "Bhayshul Tuten": "North Carolina A&T", "Jacory Croskey-Merritt": "Alabama State|New Mexico", "Matthew Golden": "Houston",
    "Tre Harris": "Louisiana Tech", "Jayden Higgins": "Eastern Kentucky", "Kyle Williams": "UNLV", "Jack Bech": "LSU", "Wan'Dale Robinson": "Nebraska", "Ricky Pearsall": "Arizona State",
    "Isaac TeSlaa": "Hillsdale", "AJ Barner": "Indiana", "Erick All": "Michigan", "Joe Flacco": "Pittsburgh", "Joe Milton III": "Michigan", "Gardner Minshew II": "Troy|East Carolina",
    "Russell Wilson": "NC State", "Justin Fields": "Georgia", "Will Levis": "Penn State", "Spencer Rattler": "Oklahoma", "Dillon Gabriel": "UCF", "Tory Horton": "Nevada", "Kendre Miller": "",
  };
  const norm = (x) => String(x || "").toLowerCase().replace(/\bst\.?$/, "state").replace(/[^a-z]/g, "");
  const wasAt = (p, school) => norm(schoolOf(p)) === norm(school) || String(EARLIER[p.n] || "").split("|").some((x) => x && norm(x) === norm(school));

  // built from the pool: which team a star plays for
  function teamQ(sport, players, r) {
    const names = TEAMS[sport.key];
    if (!names) return null;
    const top = known(players, 30, sport);
    if (top.length < 4) return null;
    const p = top[Math.floor(r() * top.length)], right = names[p.t];
    if (!right) return null;
    const wrong = shuffle(Object.keys(names).filter((t) => t !== p.t), r).slice(0, 3).map((t) => names[t]);
    return { id: `team:${p.id}`, q: `Which team does ${p.n} play for?`, a: right, w: wrong };
  }
  // built from the pool: four well-known players at one position, three from the same school
  function schoolQ(sport, players, r) {
    if (sport.key !== "nfl") return null;
    const top = known(players, 160, sport).filter(schoolOf), by = {};
    for (const p of top) { const k = main(p) + "|" + schoolOf(p); (by[k] = by[k] || []).push(p); }
    const groups = Object.entries(by).filter(([, ps]) => ps.length >= 3);
    if (!groups.length) return null;
    const [k, ps] = groups[Math.floor(r() * groups.length)], [pos, school] = k.split("|");
    const three = shuffle(ps, r).slice(0, 3);
    const others = top.filter((p) => main(p) === pos && !wasAt(p, school)).slice(0, 24);
    if (!others.length) return null;
    const odd = others[Math.floor(r() * others.length)];
    return { id: `school:${k}`, q: `Which of these ${POS[pos][1]} didn't play college football at ${school}?`, a: odd.n, w: three.map((p) => p.n) };
  }
  // built from the pool: which of four stars plays a position. Basketball and baseball players can have more than
  // one position, so the wrong choices are players who can't play it at all (a center against guards and wings).
  const POS_Q = {
    nfl: () => ["QB", "RB", "WR", "TE"].map((x) => [POS[x][0], (p) => main(p) === x, (p) => main(p) !== x]),
    nba: () => [["center", (p) => S.positions(p).includes("C"), (p) => !S.positions(p).some((x) => x === "C" || x === "PF")],
      ["point guard", (p) => S.positions(p).includes("PG"), (p) => !S.positions(p).some((x) => x === "PG" || x === "SG")]],
    // only pitcher or not: who catches or plays first is too fuzzy, and Ohtani is both
    mlb: () => [["pitcher", (p) => !/Ohtani/.test(p.n) && S.positions(p).some((x) => x === "SP" || x === "RP"), (p) => !/Ohtani/.test(p.n) && !S.positions(p).some((x) => x === "SP" || x === "RP")]],
  };
  function posQ(sport, players, r) {
    const kinds = POS_Q[sport.key] ? POS_Q[sport.key]() : null;
    if (!kinds) return null;
    const top = known(players, 60, sport), [label, is, isnt] = kinds[Math.floor(r() * kinds.length)], pos = label;
    const right = top.filter(is), wrong = top.filter(isnt);
    if (!right.length || wrong.length < 3) return null;
    const a = right[Math.floor(r() * Math.min(12, right.length))];
    return { id: `pos:${a.id}`, q: `Which of these players is a ${pos}?`, a: a.n, w: shuffle(wrong.slice(0, 30), r).slice(0, 3).map((p) => p.n) };
  }

  // A question for one pick: the same on every page for the same seed. Skips ones already asked (used).
  function make(sport, players, seed, used) {
    const r = rng(seed), seen = new Set(used || []);
    for (let tries = 0; tries < 80; tries++) {
      // a long draft can run through them all: then a question can come around again
      if (tries === 60) seen.clear();
      const roll = r(), kind = roll < 0.55 ? "bank" : roll < 0.75 ? "school" : roll < 0.9 ? "team" : "pos";
      const bank = BANKS[sport.key];
      const x = kind === "bank" ? (bank ? bank[Math.floor(r() * bank.length)] : null) : kind === "school" ? schoolQ(sport, players, r) : kind === "team" ? teamQ(sport, players, r) : posQ(sport, players, r);
      if (!x || seen.has(x.id)) continue;
      const opts = shuffle([x.a].concat(x.w), r);
      return { id: x.id, q: x.q, opts, c: opts.indexOf(x.a) };
    }
    return null;
  }
  return { BANK, BANKS, make };
});

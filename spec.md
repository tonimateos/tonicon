# A page for my concerts

The goal of the page is to:

- Let myself and my friends know which concerts I am going to easily
- See info about each of those concerts
- Allow friends to easily say that they are interested, or that they are going to
- Allow myself to add new concerts that I am going to

# Details

- It must be minimal.
- It must be easy to use on mobile.
- Concerts are sorted by date
- There is no need to allow for a "search" feature
- For each concert display:
    - Date
    - Band Name
    - Name of the venue
    - A link to the 2-3 most seen youtube videos of the band
    - A button to say "I'm interested", one to say "I'm going", one to "Add any comment you want". If you're going and want to change opinion, a button to remove the I'm going.
    - When clicking one of this it asks "How are you? Add your name or a pseudonym that Toni will understand".
    - An ordered list of actions "[name] said [action] on [date]"
    - If Toni added a comment when adding the concert, disply this comment too.
    - Friends don't need a password. Just a minimal "proof you are not a bot" thing appears after entering their name. It's enough to enter a number for instance, and check it against a simple math question.

- Finally at the top of the page there is a button "Add a concert" that opens a form to add a new concert. When clicked, it asks for a a password to make sure it's Toni. This password is secret. This form contains:
    - a link field where all info about the concert will be scraped from, this link points to a place where all info is available except for the youtube videos. Gemini will helps parse this page and get the date, name and venue.
    - a field to add up to 3 youtube videos (by default empty)
    - a text field for any additional comment from Toni
    - a button "Add Concert"

- Past concerts are moved to a different tab. These past concerts are not editable any more.

# Architecture

- Next.js as framework full-stack (React for frontend and API Routes in Node.js for backend).
- Supabase DB as external database (campaign state, player stats, etc.). I have an account, the keys will be in an .env file.
- DigitalOcean App as server deployment.
- I have an Gemini account, data will be in an .env file


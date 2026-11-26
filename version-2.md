# Progression 2.0

Take the learnings from 1.x and rebuild to a new 2.x codebase.
We should use our learnings to produce more/better functionality, but also better code.
I want the core data structures and playback code to feel rock solid.

I still want it to be "quick and easy" for simple use cases.
For example, I need a quick `I IV V vi` progression to play over.

However, I want to enable much more specific use cases.
For example, I have a very specific song idea I want to model.

In some ways, version 2.0 will be retaining the simple "Generate me a backing track"
but also adding in, I want to compose the bones of a song idea.

I want to discuss this more, but I think the core idea will be allowing for simple input
to pre-seed a much more manual form/UI. So at the heart will be a more sophisticated manual UI
but there are simpler controls to pre-seed the bulk of it.

## Core Improvements

### 8th note sub division

The goal is to have more control over progressions.
I want chord changes at an 8th note grain.
Maybe this can integrate into our custom beat UI?

I'd still like the option of simple `I IV V vi` input,
but maybe that is just used to pre-fill a more complex UI that then allows detailed tweaking/authoring.

### More granular switching of styles, tempo, etc

We should be able to switch a style (bass or drums or etc) or a tempo within a song.
Likely OK to limit this to "per section" but may want to consider finer grain?

### First class looper

I want to make the looper first class and part of the software

I would like to be able to "export" loops and send them to another user

### Synthesizer and/or bass samples

The drum samples really made the application sound much much better.
We should consider samples for other instruments like piano, synth, bass.
I think as long as we can cache the samples I won't worry about the size.

### More options for "chords"

I want more control over the synth sound for the chords.
We would keep what we have as defaults, but the data structure should allow for tweaking.
This would likely be more for an agent to craft new sounds.
We may expose controls to the user but I see this more as a natural language to sound.

### UI framework

I feel like React (or something else) would be beneficial in a rewrite.
I want state management of a descriptive data structure at the core of this.
I feel like rendering UI from a data structure is worth the cost (bytes) of a framework.

### Everything data driven

I want a data structure to define the entire song.
I want it to be possible to provide docs on the data structure such that an agent could translate
natural language into the data structure to produce a song.

## Questions to discuss

### Backing track player vs song composer

This project originally started as a _simple_ backing track generator.
I still want that....but...I am also interested in building more hand crafted songs.

So I am looking to combine those 2 goals as best we can.

1. Still have the option for a simple "Here's a basic progression play me a beat with it" AND
2. I have something pretty specific in mind, I want to craft drums, bass, chords, etc

I think for #2 it is still useful to keep it key agnostic and talk in roman numerals and intervals,
but I am open to discuss how this should all work. HTML mockups will help us sort through this too I think.

## Plan

1. Discuss the changes
   - What is feasible?
   - What questions to answer before starting?
   - What is risky?
2. Create mock ups (clickable HTML) to show the entire application
   - Want to have a really strong sense of how the app will behave
   - Also want to understand what data is necessary
3. Design data structures to support the application
   - Make sure everything we see in the mock ups can trace back to data in our model
   - I want a really good understanding of how data is modeled and how it transforms as the app is used
4. Discuss/design URL state management
   - How much can be stored in the URL?
   - Which pieces are NOT appropriate for URL state
   - Individual query params or just serialize the entire state object (base64 or hash) into a single `?state=` param?
5. Create milestones detailing the "chunks" of work that will get us there
6. Any spikes/proof of concepts to retire risk
7. Work milestones one at a time to create the software

### How to record our plan

We can make a new doc or set of documents to record important discussion.
I do NOT want to create massive docs that record every detail/decision that we discuss.
I much prefer short concise documentation that is always rewritten to reflect latest understanding.
Only in very rare cases is it ever important to know "We used to think this, then we thought that, now we think".
So documents should default to concise language (bullets when we can) that just provide latest decisions.

## Deployment

Ideally, we will be able to deploy this alongside the existing app.
I am thinking a new branch of code in git and if github pages supports it maybe a new index-v2.html page or something.
Even if I need to manually navigate to the page that is fine.
I'd just like to be able to have both running at once.

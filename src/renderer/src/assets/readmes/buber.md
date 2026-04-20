# BUBER

BUBER turns BeamNG.drive Career Mode into a ride-share, taxi, shared ride, and bus route side hustle. Take fares, keep passengers happy, build your driver rating, unlock bigger jobs, and work your way from small local pickups to full city routes.

## What It Does

BUBER adds a Career Mode taxi service with its own UI app, fare offers, passenger types, payout balancing, driver rating, progression unlocks, shared rides, bus routes, and optional taxi meter.

You go on duty, wait for dispatch, accept or reject incoming fares, drive to the pickup, then deliver the passengers to their destination. Bigger vehicles can carry more passengers, but your usable seats and payout ceiling are controlled by your driver rating so the economy cannot be abused too early.

## Features

- BUBER dashboard styled like an in-game taxi app.
- Incoming fare popup with passenger count, route length, base fare, and passenger value.
- Optional taxi meter UI for live trips.
- Adjustable UI settings for panel size, opacity, popup position, meter size, meter opacity, meter location, and meter toggle.
- Direct point-to-point fares for normal vehicles.
- Occasional shared rides for 4+ seat vehicles after route progression unlocks.
- Full bus route jobs for high-capacity vehicles.
- Dynamic vehicle seat counting with rating-based seat caps.
- Vehicle class payout multipliers based on performance index.
- Passenger types with different preferences, tips, and rating behavior.
- Driver rating progression with unlock milestones.
- Payout caps and smoothing to keep earnings useful without becoming ridiculous.
- Bus stop boarding and drop-off flow with door/service checks.
- Route restore support after tow/recovery events.
- Return-to-vehicle grace timer if you leave the vehicle after pickup.
- Temporary debug commands for showing taxi spots and bus stops while testing locations.

## Passenger Types

BUBER can dispatch different passenger groups, each with its own payout style and ride expectations.

- Standard: balanced fares that value speed and efficiency.
- Business: schedule-focused passengers who reward efficient driving.
- Commuter: everyday passengers with steady expectations.
- Executive: premium riders who expect smooth, professional service.
- Family: larger groups that value safe, smooth rides.
- Luxury: high-paying passengers who prefer comfort over speed.
- Party: groups that can reward lively but controlled driving.
- Student: budget-focused passengers with simpler expectations.
- Thrill: riders who enjoy excitement but still punish sloppy driving.
- Tourist: scenic passengers who prefer a comfortable trip.

Passenger feedback popups are intentionally quiet during the drive, so the UI does not spam messages while you are working.

## How To Play

1. Add the BUBER UI app to your BeamNG.drive UI layout.
2. Enter a valid personal vehicle in Career Mode.
3. Press the duty toggle to go on duty.
4. Wait for an incoming fare.
5. Accept the fare from the popup or dashboard.
6. Follow the route to the pickup zone.
7. Pick up the passengers and follow the route to the destination.
8. Complete the fare to earn money and receive a passenger rating.

For shared rides and bus routes, follow each stop in order. The meter will show the current route state, onboard passengers, next stop or drop-off, and boarding/drop-off instructions.

## Driver Rating System

Your driver rating is the main progression value. Completing fares raises your long-term rating based on passenger satisfaction. Abandoning a live fare after pickup reduces it.

Higher rating unlocks:

- Higher payout caps.
- More usable vehicle seats.
- Larger passenger groups.
- Shared rides and bus route jobs.
- Better earning potential for larger vehicles.

## Progression Unlocks

| Driver rating | Direct fare cap | Route fare cap | Seat cap | Unlock note |
| --- | ---: | ---: | ---: | --- |
| 0.0 | $300 | Locked | 4 | Direct BUBER fares are available. |
| 0.2 | $500 | Locked | 4 | Early payout ceiling increases. |
| 0.4 | $700 | Locked | 5 | Small groups become easier to serve. |
| 0.6 | $900 | Locked | 5 | Direct fare cap keeps climbing. |
| 0.8 | $1,100 | Locked | 6 | More passenger capacity opens up. |
| 1.0 | $1,300 | Locked | 8 | Better direct fares and larger groups. |
| 1.5 | $1,800 | Locked | 12 | Bigger jobs start appearing more often. |
| 2.0 | $2,500 | $4,500 | 18 | Shared rides and bus routes unlock. |
| 2.5 | $3,300 | $6,000 | 25 | Route payouts and seat capacity increase. |
| 3.0 | $4,200 | $8,000 | 35 | Large multi-stop work opens up. |
| 3.5 | $5,200 | $10,000 | 50 | Higher route limits and more seats. |
| 4.0 | $6,500 | $12,500 | 65 | Strong direct and route payouts. |
| 4.5 | $7,600 | $14,500 | 80 | Most vehicle seats can be used. |
| 5.0 | $8,500 | $16,500 | Vehicle max | Full vehicle capacity unlocked. |

Route-style fares stay locked until 2.0 driver rating. Shared rides can appear in normal 4+ seat vehicles, while full bus routes still need high-capacity vehicles.

## Payout System

BUBER calculates pay using several factors:

- Distance to travel.
- Passenger count.
- Passenger type value.
- Vehicle class multiplier.
- Fare streak multiplier.
- Passenger tips.
- Rating-based payout cap.
- Soft cap smoothing for very large fares.

The goal is to make fares feel worth doing while preventing extreme payouts from single jobs.

## Vehicle And Seat System

BUBER reads the current vehicle and estimates usable seats from the vehicle data. Your real vehicle capacity still matters, but the driver rating seat cap limits how many passengers you can take until you progress.

Examples:

- A small car can serve direct fares and, once unlocked, occasional shared rides.
- A van or SUV can serve larger groups as your rating improves.
- A bus can eventually use its full capacity, but only after enough rating progression.

## Shared Rides

Shared rides are car-sized multi-stop fares. They are separate from full bus routes.

Shared rides currently work like this:

- Require route progression unlocks.
- Require at least 4 available seats.
- Appear occasionally rather than replacing normal fares.
- Use one normal pickup spot.
- Use 2 to 3 normal taxi drop-off spots.
- Carry a small group of passengers across multiple drop-offs.
- Use normal taxi stopping instead of bus door logic.

This makes regular cars feel more like ride-share vehicles without turning every job into a bus route.

## Bus Routes

Bus routes unlock at 2.0 driver rating, but they still need a high-capacity vehicle. These use BeamNG route/stop data where available and turn the trip into a full multi-stop job.

Bus route work includes:

- First stop pickup.
- Multiple scheduled stops.
- Boarding and drop-off flow.
- Door/service prompts.
- Onboard passenger tracking.
- Larger route payouts with route-specific caps.

## Return-To-Vehicle Timer

If you leave the vehicle before pickup, the fare is cancelled without a rating penalty.

If passengers are already onboard, BUBER gives you a 20 second timer to return to the vehicle. Getting back in resumes the trip and restores the route. If the timer runs out, the passenger abandons the trip and the normal rating penalty applies.

## UI Settings

Open the BUBER app and press the gear button to change UI settings.

You can adjust:

- Main panel opacity.
- Main panel size.
- Fare popup opacity.
- Fare popup size.
- Fare popup location.
- Meter opacity.
- Meter size.
- Meter location.
- Meter enabled/disabled.

Settings are saved and restored so the meter keeps its chosen layout after UI reloads or tow/recovery events.

## Installation

Install the packaged BUBER zip like a normal BeamNG.drive mod.

## Notes

- BUBER is built for BeamNG.drive Career Mode.
- Some route features depend on the current level having suitable taxi spots or bus route data.
- The in-game UI must be added to your layout before you can control the service from the app.
